import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { SECRETS_GATEWAY } from '../../core/gateways/ISecretsGateway';
import { VARIABLES_GATEWAY } from '../../core/gateways/IVariablesGateway';
import type { LedgerItem } from '../../core/Types';
import {
  ClearFakeSession,
  CreateFakeSecretsGateway,
  CreateFakeVariablesGateway,
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
  let fakeVariablesGateway: ReturnType<typeof CreateFakeVariablesGateway>;

  beforeEach(async () => {
    SeedFakeSession();
    fakeVariablesGateway = CreateFakeVariablesGateway();

    await TestBed.configureTestingModule({
      imports: [CopyItemDialogComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: VARIABLES_GATEWAY, useValue: fakeVariablesGateway },
        { provide: SECRETS_GATEWAY, useValue: CreateFakeSecretsGateway() },
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
    'copies the value to every checked destination',
    fakeAsync(() => {
      fakeVariablesGateway.CreateVariable.and.resolveTo();
      fakeVariablesGateway.UpdateVariable.and.resolveTo();
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

      // Organization has no existing item -> create; staging already has one -> update.
      expect(fakeVariablesGateway.CreateVariable).toHaveBeenCalledWith({ org: 'acme-corp' }, 'organization', 'API_URL', 'https://example.com');
      expect(fakeVariablesGateway.UpdateVariable).toHaveBeenCalledWith(
        { org: 'acme-corp', repo: 'widgets', env: 'staging' },
        'environment',
        'API_URL',
        'API_URL',
        'https://example.com',
      );
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
