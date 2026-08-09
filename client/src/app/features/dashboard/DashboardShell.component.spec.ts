import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ENVIRONMENTS_GATEWAY } from '../../core/gateways/IEnvironmentsGateway';
import { LEDGER_GATEWAY } from '../../core/gateways/ILedgerGateway';
import { OAUTH_GATEWAY } from '../../core/gateways/IOAuthGateway';
import { RUNNERS_GATEWAY } from '../../core/gateways/IRunnersGateway';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import { SECRETS_GATEWAY } from '../../core/gateways/ISecretsGateway';
import { VARIABLES_GATEWAY } from '../../core/gateways/IVariablesGateway';
import type { LedgerItem } from '../../core/Types';
import {
  ClearFakeSession,
  CreateFakeEnvironmentsGateway,
  CreateFakeLedgerGateway,
  CreateFakeOAuthGateway,
  CreateFakeRunnersGateway,
  CreateFakeScopesGateway,
  CreateFakeSecretsGateway,
  CreateFakeVariablesGateway,
  ProvideTestQueryClient,
  SeedFakeSession,
} from '../../core/testing/TestDoubles';
import { WaitFor } from '../../core/testing/WaitFor';
import { DashboardShellComponent } from './DashboardShell.component';

const REPO_VARIABLE: LedgerItem = {
  id: 'variable:repository:acme-corp:widgets::API_URL',
  kind: 'variable',
  level: 'repository',
  scope: { org: 'acme-corp', repo: 'widgets' },
  name: 'API_URL',
  value: 'https://example.com',
  createdAt: '',
  updatedAt: '',
};

describe('DashboardShellComponent', () => {
  afterEach(() => ClearFakeSession());

  /** Configures a fresh TestBed for the given route params and returns a ready, change-detected fixture. */
  async function CreateFixture(
    params: Record<string, string>,
    options: { variables?: LedgerItem[] } = {},
  ): Promise<{
    fixture: ComponentFixture<DashboardShellComponent>;
    fakeVariablesGateway: ReturnType<typeof CreateFakeVariablesGateway>;
    fakeLedgerGateway: ReturnType<typeof CreateFakeLedgerGateway>;
  }> {
    SeedFakeSession();

    const fakeEnvironmentsGateway = CreateFakeEnvironmentsGateway();
    fakeEnvironmentsGateway.ListEnvironments.and.resolveTo([{ id: 1, name: 'staging' }]);

    const fakeScopesGateway = CreateFakeScopesGateway();
    fakeScopesGateway.GetAccountType.and.resolveTo('Organization');

    const fakeVariablesGateway = CreateFakeVariablesGateway();
    fakeVariablesGateway.DeleteVariable.and.resolveTo();

    const fakeSecretsGateway = CreateFakeSecretsGateway();

    const fakeLedgerGateway = CreateFakeLedgerGateway();
    fakeLedgerGateway.GetLedger.and.resolveTo({
      items: options.variables ?? [],
      partialErrors: [],
      lockedSections: [],
    });

    const fakeRunnersGateway = CreateFakeRunnersGateway();
    fakeRunnersGateway.ListRunners.and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [DashboardShellComponent],
      providers: [
        provideRouter([]),
        ProvideTestQueryClient(),
        { provide: ENVIRONMENTS_GATEWAY, useValue: fakeEnvironmentsGateway },
        { provide: SCOPES_GATEWAY, useValue: fakeScopesGateway },
        { provide: OAUTH_GATEWAY, useValue: CreateFakeOAuthGateway() },
        { provide: VARIABLES_GATEWAY, useValue: fakeVariablesGateway },
        { provide: SECRETS_GATEWAY, useValue: fakeSecretsGateway },
        { provide: LEDGER_GATEWAY, useValue: fakeLedgerGateway },
        { provide: RUNNERS_GATEWAY, useValue: fakeRunnersGateway },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(params)) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DashboardShellComponent);
    // See core/testing/WaitFor.ts — TanStack Angular Query runs outside NgZone, so
    // whenStable() can't observe the environments/ledger/runners queries resolving; poll for
    // real instead. Absence of any loading skeleton (RunnersPanel renders one) is a reasonable
    // proxy for "the initial round of queries has settled".
    await WaitFor(fixture, () => !fixture.nativeElement.querySelector('.animate-pulse'));
    return { fixture, fakeVariablesGateway, fakeLedgerGateway };
  }

  it('shows the org/repo breadcrumb from the route params', async () => {
    const { fixture } = await CreateFixture({ owner: 'acme-corp', repo: 'widgets' });

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('acme-corp / widgets');
  });

  it('shows the sidebar and the List/Compare toggle for a repo scope, and switches views', async () => {
    const { fixture } = await CreateFixture({ owner: 'acme-corp', repo: 'widgets' });

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
    const compareButton = buttons.find((b) => b.textContent?.trim() === 'Compare')!;
    expect(compareButton).toBeTruthy();

    compareButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-compare-view')).not.toBeNull();
  });

  it('opens the delete-environment confirmation when the sidebar requests it', async () => {
    const { fixture } = await CreateFixture({ owner: 'acme-corp', repo: 'widgets' });
    // The environments query (which populates this button) and the runners query (which
    // CreateFixture's generic wait is keyed off) settle independently — wait for this one specifically.
    await WaitFor(fixture, () => !!fixture.nativeElement.querySelector('[title=\'Delete environment "staging"\']'));

    const deleteButton = fixture.nativeElement.querySelector('[title=\'Delete environment "staging"\']') as HTMLButtonElement;
    deleteButton.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Delete environment "staging"?');
  });

  it('org-only scope has no List/Compare toggle', async () => {
    const { fixture } = await CreateFixture({ org: 'acme-corp' });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('acme-corp');
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.some((b) => b.textContent?.trim() === 'Compare')).toBe(false);
  });

  it('renders the ledger with a fetched variable', async () => {
    const { fixture } = await CreateFixture({ owner: 'acme-corp', repo: 'widgets' }, { variables: [REPO_VARIABLE] });
    await WaitFor(fixture, () => (fixture.nativeElement as HTMLElement).textContent?.includes('API_URL') ?? false);

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('https://example.com');
  });

  it('opens the real copy dialog when a ledger row emits copy', async () => {
    const { fixture } = await CreateFixture({ owner: 'acme-corp', repo: 'widgets' }, { variables: [REPO_VARIABLE] });
    await WaitFor(fixture, () => (fixture.nativeElement as HTMLElement).textContent?.includes('API_URL') ?? false);

    const copyButton = fixture.nativeElement.querySelector('[title="Copy to another environment"]') as HTMLButtonElement;
    copyButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-copy-item-dialog')).not.toBeNull();
  });

  it('opens the real item editor when a ledger row emits add/edit', async () => {
    const { fixture } = await CreateFixture({ owner: 'acme-corp', repo: 'widgets' }, { variables: [REPO_VARIABLE] });
    await WaitFor(fixture, () => (fixture.nativeElement as HTMLElement).textContent?.includes('API_URL') ?? false);

    const editButton = fixture.nativeElement.querySelector('[title="Edit"]') as HTMLButtonElement;
    editButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-item-editor-panel')).not.toBeNull();
  });

  it('deletes a variable through the confirm dialog', async () => {
    const { fixture, fakeVariablesGateway } = await CreateFixture(
      { owner: 'acme-corp', repo: 'widgets' },
      { variables: [REPO_VARIABLE] },
    );
    await WaitFor(fixture, () => (fixture.nativeElement as HTMLElement).textContent?.includes('API_URL') ?? false);

    const deleteButton = fixture.nativeElement.querySelector('[title="Delete"]') as HTMLButtonElement;
    deleteButton.click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Delete variable "API_URL"?');

    const confirmButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === 'Delete',
    )!;
    confirmButton.click();
    // Mutation, not a query — but this component's own onMutate hop still runs outside the test's
    // synchronous flow, so poll for the dialog closing (mutateAsync resolving) the same way as
    // any other async completion in this suite, rather than reaching for fakeAsync/tick here.
    await WaitFor(fixture, () => !(fixture.nativeElement as HTMLElement).textContent?.includes('Delete variable "API_URL"?'));

    expect(fakeVariablesGateway.DeleteVariable).toHaveBeenCalledWith(REPO_VARIABLE.scope, 'repository', 'API_URL');
  });

  it('exports the ledger and triggers a download when Export is clicked', async () => {
    const { fixture, fakeLedgerGateway } = await CreateFixture({ owner: 'acme-corp', repo: 'widgets' });
    const fakeBlob = new Blob(['workbook bytes']);
    let resolveExport!: (value: { blob: Blob; filename: string }) => void;
    fakeLedgerGateway.ExportLedger.and.returnValue(new Promise((resolve) => (resolveExport = resolve)));
    spyOn(URL, 'createObjectURL').and.returnValue('blob:fake-url');
    spyOn(URL, 'revokeObjectURL');
    spyOn(HTMLAnchorElement.prototype, 'click');

    const exportButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) =>
      b.textContent?.trim().startsWith('Export'),
    )!;
    exportButton.click();
    fixture.detectChanges();

    expect(exportButton.textContent?.trim()).toBe('Exporting…');
    expect(exportButton.disabled).toBe(true);
    expect(fakeLedgerGateway.ExportLedger).toHaveBeenCalledWith('acme-corp', 'widgets');

    resolveExport({ blob: fakeBlob, filename: 'acme-corp-widgets-variables-secrets-2026-08-09.xlsx' });
    await WaitFor(fixture, () => exportButton.textContent?.trim() === 'Export');

    expect(URL.createObjectURL).toHaveBeenCalledWith(fakeBlob);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('shows an error message when the export fails', async () => {
    const { fixture, fakeLedgerGateway } = await CreateFixture({ owner: 'acme-corp', repo: 'widgets' });
    fakeLedgerGateway.ExportLedger.and.rejectWith(new Error('GitHub rejected this request.'));

    const exportButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) =>
      b.textContent?.trim().startsWith('Export'),
    )!;
    exportButton.click();
    fixture.detectChanges();

    await WaitFor(
      fixture,
      () => (fixture.nativeElement as HTMLElement).textContent?.includes('GitHub rejected this request.') ?? false,
    );

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('GitHub rejected this request.');
    expect(exportButton.textContent?.trim()).toBe('Export');
  });

  it('navigates to /connect when Disconnect is clicked', async () => {
    const { fixture } = await CreateFixture({ owner: 'acme-corp', repo: 'widgets' });
    const router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);

    const disconnectButton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Disconnect')!;
    disconnectButton.click();
    fixture.detectChanges();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/connect');
  });
});
