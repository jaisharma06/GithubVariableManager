import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { LEDGER_GATEWAY } from '../../core/gateways/ILedgerGateway';
import type { LedgerItem } from '../../core/Types';
import {
  ClearFakeSession,
  CreateFakeLedgerGateway,
  ProvideTestQueryClient,
  SeedFakeSession,
} from '../../core/testing/TestDoubles';
import { CopyItemDialogComponent } from './CopyItemDialog.component';

const VARIABLE: LedgerItem = {
  id: 'variable:repository:acme-corp:widgets::API_URL',
  kind: 'variable',
  level: 'repository',
  scope: { org: 'acme-corp', repo: 'widgets' },
  name: 'API_URL',
  value: 'https://example.com',
  createdAt: '',
  updatedAt: '',
};

const STAGING_VARIABLE: LedgerItem = {
  ...VARIABLE,
  id: 'variable:environment:acme-corp:widgets:staging:API_URL',
  level: 'environment',
  scope: { org: 'acme-corp', repo: 'widgets', env: 'staging' },
  value: 'https://staging.example.com',
};

describe('CopyItemDialogComponent', () => {
  let fixture: ComponentFixture<CopyItemDialogComponent>;
  let fakeLedgerGateway: ReturnType<typeof CreateFakeLedgerGateway>;

  beforeEach(async () => {
    SeedFakeSession();
    fakeLedgerGateway = CreateFakeLedgerGateway();

    await TestBed.configureTestingModule({
      imports: [CopyItemDialogComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: LEDGER_GATEWAY, useValue: fakeLedgerGateway },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CopyItemDialogComponent);
    fixture.componentRef.setInput('item', VARIABLE);
    fixture.componentRef.setInput('scope', { org: 'acme-corp', repo: 'widgets' });
    fixture.componentRef.setInput('environments', [{ id: 1, name: 'staging' }]);
    fixture.componentRef.setInput('showOrgLevel', true);
    fixture.componentRef.setInput('items', [VARIABLE, STAGING_VARIABLE]);
    fixture.detectChanges();
  });

  afterEach(() => ClearFakeSession());

  it('pre-fills the value with the source variable\'s current value', () => {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('https://example.com');
  });

  it('lists every other scope, excluding the source, with an overwrite/matches/not-set hint', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Organization · acme-corp');
    expect(text).not.toContain('Repository · widgets');
    expect(text).toContain('staging');
    expect(text).toContain('will overwrite');
    expect(text).toContain('not set');
  });

  it('shows "already matches" for a variable whose destination value equals the current value', () => {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'https://staging.example.com';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('already matches');
  });

  it('requires at least one destination to be selected', () => {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Choose at least one destination.');
  });

  it(
    'copies the value to every checked destination in one Copy call',
    fakeAsync(() => {
      // The create-vs-update-per-target decision is made server-side now
      // (Services/CopyService.cs) — this dialog just assembles the full target list and lets
      // CopyFacade.CopyTo/ILedgerGateway.Copy fan it out in one backend call.
      const targets = [
        { level: 'organization' as const, scope: { org: 'acme-corp' } },
        { level: 'environment' as const, scope: { org: 'acme-corp', repo: 'widgets', env: 'staging' } },
      ];
      fakeLedgerGateway.Copy.and.resolveTo(targets.map((target) => ({ target, ok: true })));
      const closedSpy = jasmine.createSpy('closed');
      fixture.componentInstance.closed.subscribe(closedSpy);

      const selectAllButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
        (b) => b.textContent?.trim() === 'Select all',
      )!;
      selectAllButton.click();
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
      tick();
      fixture.detectChanges();

      expect(fakeLedgerGateway.Copy).toHaveBeenCalledTimes(1);
      expect(fakeLedgerGateway.Copy).toHaveBeenCalledWith('variable', 'API_URL', 'https://example.com', targets, undefined);
      expect(closedSpy).toHaveBeenCalled();
    }),
  );

  it('emits closed on Escape', () => {
    const closedSpy = jasmine.createSpy('closed');
    fixture.componentInstance.closed.subscribe(closedSpy);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(closedSpy).toHaveBeenCalled();
  });
});
