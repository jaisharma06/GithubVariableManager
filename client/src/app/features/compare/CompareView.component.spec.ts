import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { LEDGER_GATEWAY } from '../../core/gateways/ILedgerGateway';
import { OAUTH_GATEWAY } from '../../core/gateways/IOAuthGateway';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import { SECRETS_GATEWAY } from '../../core/gateways/ISecretsGateway';
import { VARIABLES_GATEWAY } from '../../core/gateways/IVariablesGateway';
import type { LedgerItem } from '../../core/Types';
import {
  ClearFakeSession,
  CreateFakeLedgerGateway,
  CreateFakeOAuthGateway,
  CreateFakeScopesGateway,
  CreateFakeSecretsGateway,
  CreateFakeVariablesGateway,
  ProvideTestQueryClient,
  SeedFakeSession,
} from '../../core/testing/TestDoubles';
import { CompareViewComponent } from './CompareView.component';

const ORG_VAR: LedgerItem = {
  id: 'variable:organization:acme-corp::API_URL',
  kind: 'variable',
  level: 'organization',
  scope: { org: 'acme-corp' },
  name: 'API_URL',
  value: 'https://org.example.com',
  createdAt: '',
  updatedAt: '',
};

const REPO_VAR: LedgerItem = {
  ...ORG_VAR,
  id: 'variable:repository:acme-corp:widgets::API_URL',
  level: 'repository',
  scope: { org: 'acme-corp', repo: 'widgets' },
  value: 'https://repo.example.com',
};

const STAGING_VAR: LedgerItem = {
  ...ORG_VAR,
  id: 'variable:environment:acme-corp:widgets:staging:API_URL',
  level: 'environment',
  scope: { org: 'acme-corp', repo: 'widgets', env: 'staging' },
  value: 'https://staging.example.com',
};

const STAGING_SECRET: LedgerItem = {
  id: 'secret:environment:acme-corp:widgets:staging:TOKEN',
  kind: 'secret',
  level: 'environment',
  scope: { org: 'acme-corp', repo: 'widgets', env: 'staging' },
  name: 'TOKEN',
  createdAt: '',
  updatedAt: '',
};

describe('CompareViewComponent', () => {
  let fixture: ComponentFixture<CompareViewComponent>;
  let fakeVariablesGateway: ReturnType<typeof CreateFakeVariablesGateway>;
  let fakeSecretsGateway: ReturnType<typeof CreateFakeSecretsGateway>;
  let fakeLedgerGateway: ReturnType<typeof CreateFakeLedgerGateway>;

  beforeEach(async () => {
    SeedFakeSession();
    fakeVariablesGateway = CreateFakeVariablesGateway();
    fakeSecretsGateway = CreateFakeSecretsGateway();
    fakeLedgerGateway = CreateFakeLedgerGateway();

    await TestBed.configureTestingModule({
      imports: [CompareViewComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: VARIABLES_GATEWAY, useValue: fakeVariablesGateway },
        { provide: SECRETS_GATEWAY, useValue: fakeSecretsGateway },
        { provide: SCOPES_GATEWAY, useValue: CreateFakeScopesGateway() },
        { provide: OAUTH_GATEWAY, useValue: CreateFakeOAuthGateway() },
        { provide: LEDGER_GATEWAY, useValue: fakeLedgerGateway },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CompareViewComponent);
    fixture.componentRef.setInput('scope', { org: 'acme-corp', repo: 'widgets' });
    fixture.componentRef.setInput('environments', [{ id: 1, name: 'staging' }]);
    fixture.componentRef.setInput('items', [ORG_VAR, REPO_VAR, STAGING_VAR, STAGING_SECRET]);
    fixture.componentRef.setInput('showOrgLevel', true);
    fixture.componentRef.setInput('isLoading', false);
    fixture.componentRef.setInput('error', null);
    fixture.detectChanges();
  });

  afterEach(() => ClearFakeSession());

  it('shows a loading skeleton while isLoading is true', () => {
    fixture.componentRef.setInput('isLoading', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows the error message when error is set', () => {
    fixture.componentRef.setInput('error', new Error('Rate limited'));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Rate limited');
  });

  it('defaults to hiding the organization/repository columns, showing only environments', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // Only the staging column's value is visible by default.
    expect(text).toContain('https://staging.example.com');
    expect(text).not.toContain('https://org.example.com');
    expect(text).not.toContain('https://repo.example.com');
  });

  it('shows a column once its pill is clicked', () => {
    const orgPill = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) =>
      b.textContent?.trim().startsWith('Org ·'),
    )!;
    orgPill.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('https://org.example.com');
  });

  it('filters rows by kind', () => {
    const secretsButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === 'Secrets',
    )!;
    secretsButton.click();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('TOKEN');
    expect(text).not.toContain('API_URL');
  });

  it('filters rows by name search', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'TOKEN';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('TOKEN');
    expect(text).not.toContain('API_URL');
  });

  it('always masks a secret value regardless of "Hide values"', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('••••••••');
  });

  it('opens the item editor, locked, from a "not set" cell', () => {
    // Show the organization column, which has no TOKEN secret set.
    const orgPill = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) =>
      b.textContent?.trim().startsWith('Org ·'),
    )!;
    orgPill.click();
    fixture.detectChanges();

    const notSetButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.includes('not set'),
    )!;
    notSetButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-item-editor-panel')).not.toBeNull();
  });

  it('opens the copy dialog from a variable cell\'s copy button', () => {
    const copyButton = fixture.nativeElement.querySelector('[title="Copy this value elsewhere"]') as HTMLButtonElement;
    copyButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-copy-item-dialog')).not.toBeNull();
  });

  it('opens the delete-everywhere confirmation listing every occurrence', () => {
    const deleteButton = fixture.nativeElement.querySelector('[title*="every scope it\'s set in"]') as HTMLButtonElement;
    deleteButton.click();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Delete "API_URL" from all 3 scopes?');
    expect(text).toContain('staging');
  });

  it(
    'deletes a row from every scope on confirm',
    fakeAsync(() => {
      const targets = [
        { level: 'organization' as const, scope: { org: 'acme-corp' }, label: 'Org · acme-corp' },
        { level: 'repository' as const, scope: { org: 'acme-corp', repo: 'widgets' }, label: 'Repo · widgets' },
        { level: 'environment' as const, scope: { org: 'acme-corp', repo: 'widgets', env: 'staging' }, label: 'staging' },
      ];
      fakeLedgerGateway.DeleteEverywhere.and.resolveTo(targets.map((target) => ({ target, ok: true })));
      const deleteButton = fixture.nativeElement.querySelector('[title*="every scope it\'s set in"]') as HTMLButtonElement;
      deleteButton.click();
      fixture.detectChanges();

      const confirmButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
        (b) => b.textContent?.trim() === 'Delete everywhere',
      )!;
      confirmButton.click();
      tick();
      fixture.detectChanges();

      // DeleteEverywhereFacade.DeleteFrom -> ILedgerGateway.DeleteEverywhere is now one backend
      // call fanning out over the full target list, replacing N separate DeleteVariable calls.
      expect(fakeLedgerGateway.DeleteEverywhere).toHaveBeenCalledTimes(1);
      expect(fakeLedgerGateway.DeleteEverywhere).toHaveBeenCalledWith('variable', 'API_URL', targets);
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Delete "API_URL" from all');
    }),
  );

  it('shows "Pick at least one scope" when every column is deselected', () => {
    const stagingPill = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === 'staging',
    )!;
    stagingPill.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Pick at least one scope above to compare.');
  });
});
