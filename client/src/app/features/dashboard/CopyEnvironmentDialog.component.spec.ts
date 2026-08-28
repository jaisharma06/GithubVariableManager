import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ENVIRONMENTS_GATEWAY } from '../../core/gateways/IEnvironmentsGateway';
import { LEDGER_GATEWAY } from '../../core/gateways/ILedgerGateway';
import { OAUTH_GATEWAY } from '../../core/gateways/IOAuthGateway';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import {
  ClearFakeSession,
  CreateFakeEnvironmentsGateway,
  CreateFakeLedgerGateway,
  CreateFakeOAuthGateway,
  CreateFakeScopesGateway,
  ProvideTestQueryClient,
  SeedFakeSession,
} from '../../core/testing/TestDoubles';
import { WaitFor } from '../../core/testing/WaitFor';
import { CopyEnvironmentDialogComponent } from './CopyEnvironmentDialog.component';

function FindButton(fixture: ComponentFixture<unknown>, text: string): HTMLButtonElement | undefined {
  return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) =>
    b.textContent?.trim().includes(text),
  );
}

describe('CopyEnvironmentDialogComponent', () => {
  let fixture: ComponentFixture<CopyEnvironmentDialogComponent>;
  let fakeScopesGateway: ReturnType<typeof CreateFakeScopesGateway>;
  let fakeEnvironmentsGateway: ReturnType<typeof CreateFakeEnvironmentsGateway>;
  let fakeLedgerGateway: ReturnType<typeof CreateFakeLedgerGateway>;

  beforeEach(async () => {
    SeedFakeSession();

    fakeScopesGateway = CreateFakeScopesGateway();
    fakeScopesGateway.ListMyOrgs.and.resolveTo([]);
    fakeScopesGateway.ListMyRepos.and.resolveTo([
      { id: 2, name: 'widgets', fullName: 'acme-corp/widgets', owner: 'acme-corp', private: false },
    ]);
    fakeScopesGateway.ListOrgRepos.and.resolveTo([]);

    fakeEnvironmentsGateway = CreateFakeEnvironmentsGateway();
    fakeEnvironmentsGateway.ListEnvironments.and.resolveTo([
      { id: 1, name: 'staging' },
      { id: 2, name: 'production' },
    ]);

    fakeLedgerGateway = CreateFakeLedgerGateway();

    await TestBed.configureTestingModule({
      imports: [CopyEnvironmentDialogComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: SCOPES_GATEWAY, useValue: fakeScopesGateway },
        { provide: ENVIRONMENTS_GATEWAY, useValue: fakeEnvironmentsGateway },
        { provide: LEDGER_GATEWAY, useValue: fakeLedgerGateway },
        { provide: OAUTH_GATEWAY, useValue: CreateFakeOAuthGateway() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CopyEnvironmentDialogComponent);
    fixture.componentRef.setInput('org', 'acme-corp');
    fixture.componentRef.setInput('repo', 'widgets');
    fixture.componentRef.setInput('sourceEnv', 'staging');
    fixture.detectChanges();

    // The header always shows "org/repo" (the copy *source*) regardless of picker state, so wait
    // for the destination-repo *button* specifically, not just that substring anywhere on the page.
    await WaitFor(fixture, () => !!FindButton(fixture, 'acme-corp/widgets'));
  });

  afterEach(() => ClearFakeSession());

  it('shows the source org/repo/environment in the header', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('acme-corp/widgets');
    expect(text).toContain('staging');
  });

  it('disables submit until a destination repo and environment are both picked', async () => {
    expect(FindButton(fixture, 'Copy')!.disabled).toBeTrue();

    FindButton(fixture, 'acme-corp/widgets')!.click();
    fixture.detectChanges();
    await WaitFor(fixture, () => fixture.nativeElement.querySelectorAll('select').length > 0);

    expect(FindButton(fixture, 'Copy')!.disabled).toBeTrue();

    // The <select> renders before its <option>s do (they depend on the async environments
    // query) — wait for the actual "production" option, not just the <select> element existing,
    // or setting .value below silently no-ops (no matching option yet).
    await WaitFor(fixture, () =>
      Array.from(fixture.nativeElement.querySelectorAll('option') as NodeListOf<HTMLOptionElement>).some(
        (o) => o.value === 'production',
      ),
    );

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'production';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(FindButton(fixture, 'Copy')!.disabled).toBeFalse();
  });

  it('calls EnvironmentsFacade.copyEnvironmentVariables with the picked destination and renders the outcome', async () => {
    fakeLedgerGateway.CopyEnvironmentVariables.and.resolveTo({
      copied: ['NEW_VAR'],
      skipped: ['ALREADY_THERE'],
      failures: [],
    });

    FindButton(fixture, 'acme-corp/widgets')!.click();
    fixture.detectChanges();
    // The <select> renders before its <option>s do (they depend on the async environments
    // query) — wait for the actual "production" option, not just the <select> element existing,
    // or setting .value below silently no-ops (no matching option yet).
    await WaitFor(fixture, () =>
      Array.from(fixture.nativeElement.querySelectorAll('option') as NodeListOf<HTMLOptionElement>).some(
        (o) => o.value === 'production',
      ),
    );

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'production';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    await WaitFor(fixture, () => (fixture.nativeElement.textContent ?? '').includes('NEW_VAR'));

    expect(fakeLedgerGateway.CopyEnvironmentVariables).toHaveBeenCalledWith(
      { org: 'acme-corp', repo: 'widgets', env: 'staging' },
      { org: 'acme-corp', repo: 'widgets', env: 'production' },
    );
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('NEW_VAR');
    expect(text).toContain('ALREADY_THERE');
  });

  it('blocks picking the same environment as the source', async () => {
    FindButton(fixture, 'acme-corp/widgets')!.click();
    fixture.detectChanges();
    await WaitFor(fixture, () =>
      Array.from(fixture.nativeElement.querySelectorAll('option') as NodeListOf<HTMLOptionElement>).some(
        (o) => o.value === 'staging',
      ),
    );

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'staging';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(FindButton(fixture, 'Copy')!.disabled).toBeTrue();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('same as the source');
  });
});
