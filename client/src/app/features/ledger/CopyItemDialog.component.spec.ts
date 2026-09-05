import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ENVIRONMENTS_GATEWAY } from '../../core/gateways/IEnvironmentsGateway';
import { LEDGER_GATEWAY } from '../../core/gateways/ILedgerGateway';
import { OAUTH_GATEWAY } from '../../core/gateways/IOAuthGateway';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import type { LedgerItem } from '../../core/Types';
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

const ORG_SECRET: LedgerItem = {
  id: 'secret:organization:acme-corp::SHARED_KEY',
  kind: 'secret',
  level: 'organization',
  scope: { org: 'acme-corp' },
  name: 'SHARED_KEY',
  createdAt: '',
  updatedAt: '',
};

function FindButton(fixture: ComponentFixture<unknown>, text: string): HTMLButtonElement | undefined {
  return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
    (b) => b.textContent?.trim() === text,
  );
}

/** The full text of the checklist row (label) for a given candidate label — lets a hint-state assertion target the specific row instead of the whole dialog's text, which can contain the same hint word from an unrelated row. */
function CandidateRowText(fixture: ComponentFixture<unknown>, labelText: string): string {
  const row = Array.from(fixture.nativeElement.querySelectorAll('label') as NodeListOf<HTMLLabelElement>).find((l) =>
    l.textContent?.includes(labelText),
  );
  return row?.textContent ?? '';
}

function OpenCrossRepoPicker(fixture: ComponentFixture<unknown>): void {
  FindButton(fixture, '+ Add another repo/org…')!.click();
  fixture.detectChanges();
}

/** Clicks an org/repo row inside the (already-open) cross-repo picker, then clicks "Add destination" once it's enabled. */
async function PickAndAdd(fixture: ComponentFixture<unknown>, rowText: string): Promise<void> {
  FindButton(fixture, rowText)!.click();
  fixture.detectChanges();

  await WaitFor(fixture, () => {
    const addButton = FindButton(fixture, 'Add destination');
    return !!addButton && !addButton.disabled;
  });

  FindButton(fixture, 'Add destination')!.click();
  fixture.detectChanges();
}

describe('CopyItemDialogComponent', () => {
  let fixture: ComponentFixture<CopyItemDialogComponent>;
  let fakeLedgerGateway: ReturnType<typeof CreateFakeLedgerGateway>;
  let fakeScopesGateway: ReturnType<typeof CreateFakeScopesGateway>;
  let fakeEnvironmentsGateway: ReturnType<typeof CreateFakeEnvironmentsGateway>;

  beforeEach(async () => {
    SeedFakeSession();
    fakeLedgerGateway = CreateFakeLedgerGateway();
    fakeLedgerGateway.GetLedger.and.resolveTo({ items: [], partialErrors: [], lockedSections: [], corruptedManifestScopes: [] });

    fakeScopesGateway = CreateFakeScopesGateway();
    fakeScopesGateway.ListMyOrgs.and.resolveTo([{ login: 'other-org', avatarUrl: '' }]);
    fakeScopesGateway.ListMyRepos.and.resolveTo([
      { id: 10, name: 'cross-repo', fullName: 'cross-org2/cross-repo', owner: 'cross-org2', private: false },
      { id: 11, name: 'cross-repo3', fullName: 'cross-org3/cross-repo3', owner: 'cross-org3', private: false },
    ]);
    fakeScopesGateway.GetAccountType.and.resolveTo('Organization');
    fakeScopesGateway.ListOrgRepos.and.resolveTo([]);

    fakeEnvironmentsGateway = CreateFakeEnvironmentsGateway();
    fakeEnvironmentsGateway.ListEnvironments.and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [CopyItemDialogComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: LEDGER_GATEWAY, useValue: fakeLedgerGateway },
        { provide: SCOPES_GATEWAY, useValue: fakeScopesGateway },
        { provide: ENVIRONMENTS_GATEWAY, useValue: fakeEnvironmentsGateway },
        { provide: OAUTH_GATEWAY, useValue: CreateFakeOAuthGateway() },
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

  describe('cross-repo/cross-org targets', () => {
    it('appends a picked cross-repo target to the checklist with not-set/will-overwrite/already-matches hints resolved from that destination\'s own ledger', async () => {
      fakeLedgerGateway.GetLedger.and.callFake((org: string, repo?: string) => {
        if (org === 'other-org' && repo === undefined) {
          return Promise.resolve({ items: [], partialErrors: [], lockedSections: [], corruptedManifestScopes: [] });
        }
        if (org === 'cross-org2' && repo === 'cross-repo') {
          return Promise.resolve({
            items: [{ ...VARIABLE, id: 'match', scope: { org, repo }, value: 'https://example.com' }],
            partialErrors: [],
            lockedSections: [],
            corruptedManifestScopes: [],
          });
        }
        if (org === 'cross-org3' && repo === 'cross-repo3') {
          return Promise.resolve({
            items: [{ ...VARIABLE, id: 'diff', scope: { org, repo }, value: 'https://different.example.com' }],
            partialErrors: [],
            lockedSections: [],
            corruptedManifestScopes: [],
          });
        }
        return Promise.resolve({ items: [], partialErrors: [], lockedSections: [], corruptedManifestScopes: [] });
      });

      OpenCrossRepoPicker(fixture);
      await WaitFor(fixture, () => (fixture.nativeElement.textContent ?? '').includes('other-org'));

      await PickAndAdd(fixture, 'other-org');
      await WaitFor(fixture, () => CandidateRowText(fixture, 'Organization · other-org').length > 0);
      expect(CandidateRowText(fixture, 'Organization · other-org')).toContain('not set');

      await PickAndAdd(fixture, 'cross-org2/cross-repo');
      await WaitFor(fixture, () => CandidateRowText(fixture, 'Repository · cross-org2/cross-repo').length > 0);
      expect(CandidateRowText(fixture, 'Repository · cross-org2/cross-repo')).toContain('already matches');

      await PickAndAdd(fixture, 'cross-org3/cross-repo3');
      await WaitFor(fixture, () => CandidateRowText(fixture, 'Repository · cross-org3/cross-repo3').length > 0);
      expect(CandidateRowText(fixture, 'Repository · cross-org3/cross-repo3')).toContain('will overwrite');
    });

    it('a removal control drops a cross-repo candidate before submit', async () => {
      OpenCrossRepoPicker(fixture);
      await WaitFor(fixture, () => (fixture.nativeElement.textContent ?? '').includes('other-org'));
      await PickAndAdd(fixture, 'other-org');
      await WaitFor(fixture, () => (fixture.nativeElement.textContent ?? '').includes('Organization · other-org'));

      const removeButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
        (b) => b.title === 'Remove this destination',
      )!;
      removeButton.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent ?? '').not.toContain('Organization · other-org');
    });

    it('copies to same-repo and cross-repo destinations together in one Copy call', async () => {
      const targets = [
        { level: 'environment' as const, scope: { org: 'acme-corp', repo: 'widgets', env: 'staging' } },
        { level: 'organization' as const, scope: { org: 'other-org' } },
      ];
      fakeLedgerGateway.Copy.and.resolveTo(targets.map((target) => ({ target, ok: true })));
      const closedSpy = jasmine.createSpy('closed');
      fixture.componentInstance.closed.subscribe(closedSpy);

      const stagingLabel = Array.from(fixture.nativeElement.querySelectorAll('label') as NodeListOf<HTMLLabelElement>).find((l) =>
        l.textContent?.includes('staging'),
      )!;
      (stagingLabel.querySelector('input[type=checkbox]') as HTMLInputElement).click();
      fixture.detectChanges();

      OpenCrossRepoPicker(fixture);
      await WaitFor(fixture, () => (fixture.nativeElement.textContent ?? '').includes('other-org'));
      await PickAndAdd(fixture, 'other-org');
      await WaitFor(fixture, () => (fixture.nativeElement.textContent ?? '').includes('Organization · other-org'));

      (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
      await WaitFor(fixture, () => closedSpy.calls.count() > 0);

      expect(fakeLedgerGateway.Copy).toHaveBeenCalledTimes(1);
      expect(fakeLedgerGateway.Copy).toHaveBeenCalledWith('variable', 'API_URL', 'https://example.com', targets, undefined);
    });
  });
});

describe('CopyItemDialogComponent — multi-org selected-visibility guard (secret)', () => {
  let fixture: ComponentFixture<CopyItemDialogComponent>;
  let fakeLedgerGateway: ReturnType<typeof CreateFakeLedgerGateway>;
  let fakeScopesGateway: ReturnType<typeof CreateFakeScopesGateway>;
  let fakeEnvironmentsGateway: ReturnType<typeof CreateFakeEnvironmentsGateway>;

  beforeEach(async () => {
    SeedFakeSession();
    fakeLedgerGateway = CreateFakeLedgerGateway();
    fakeLedgerGateway.GetLedger.and.resolveTo({ items: [], partialErrors: [], lockedSections: [], corruptedManifestScopes: [] });

    fakeScopesGateway = CreateFakeScopesGateway();
    fakeScopesGateway.ListMyOrgs.and.resolveTo([
      { login: 'org-two', avatarUrl: '' },
      { login: 'org-three', avatarUrl: '' },
    ]);
    fakeScopesGateway.ListMyRepos.and.resolveTo([]);
    fakeScopesGateway.GetAccountType.and.resolveTo('Organization');
    fakeScopesGateway.ListOrgRepos.and.resolveTo([]);

    fakeEnvironmentsGateway = CreateFakeEnvironmentsGateway();
    fakeEnvironmentsGateway.ListEnvironments.and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [CopyItemDialogComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: LEDGER_GATEWAY, useValue: fakeLedgerGateway },
        { provide: SCOPES_GATEWAY, useValue: fakeScopesGateway },
        { provide: ENVIRONMENTS_GATEWAY, useValue: fakeEnvironmentsGateway },
        { provide: OAUTH_GATEWAY, useValue: CreateFakeOAuthGateway() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CopyItemDialogComponent);
    fixture.componentRef.setInput('item', ORG_SECRET);
    fixture.componentRef.setInput('scope', { org: 'acme-corp' });
    fixture.componentRef.setInput('environments', []);
    fixture.componentRef.setInput('showOrgLevel', false);
    fixture.componentRef.setInput('items', []);
    fixture.detectChanges();
  });

  afterEach(() => ClearFakeSession());

  it('blocks submit when two picked organization-level secret targets both use selected-repository visibility', async () => {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'super-secret-value';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    OpenCrossRepoPicker(fixture);
    await WaitFor(fixture, () => (fixture.nativeElement.textContent ?? '').includes('org-two'));

    // Pick org-two, set visibility to "selected", add.
    FindButton(fixture, 'org-two')!.click();
    fixture.detectChanges();
    let visibilitySelect = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    visibilitySelect.value = 'selected';
    visibilitySelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await WaitFor(fixture, () => {
      const addButton = FindButton(fixture, 'Add destination');
      return !!addButton && !addButton.disabled;
    });
    FindButton(fixture, 'Add destination')!.click();
    fixture.detectChanges();
    await WaitFor(fixture, () => (fixture.nativeElement.textContent ?? '').includes('Organization · org-two'));

    // Pick org-three, also with "selected" visibility, add.
    FindButton(fixture, 'org-three')!.click();
    fixture.detectChanges();
    visibilitySelect = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    visibilitySelect.value = 'selected';
    visibilitySelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await WaitFor(fixture, () => {
      const addButton = FindButton(fixture, 'Add destination');
      return !!addButton && !addButton.disabled;
    });
    FindButton(fixture, 'Add destination')!.click();
    fixture.detectChanges();
    await WaitFor(fixture, () => (fixture.nativeElement.textContent ?? '').includes('Organization · org-three'));

    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent ?? '').toContain(
      'Selected-repository visibility can only target one organization per copy',
    );
    expect(fakeLedgerGateway.Copy).not.toHaveBeenCalled();
  });
});
