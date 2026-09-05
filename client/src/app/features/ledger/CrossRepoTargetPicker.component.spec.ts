import { ComponentFixture, TestBed } from '@angular/core/testing';
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
import { CrossRepoTargetPickerComponent, type CrossRepoTargetPicked } from './CrossRepoTargetPicker.component';

const SOURCE_VARIABLE: LedgerItem = {
  id: 'variable:repository:acme-corp:widgets::API_URL',
  kind: 'variable',
  level: 'repository',
  scope: { org: 'acme-corp', repo: 'widgets' },
  name: 'API_URL',
  value: 'https://example.com',
  createdAt: '',
  updatedAt: '',
};

function FindButton(fixture: ComponentFixture<unknown>, text: string): HTMLButtonElement | undefined {
  return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
    (b) => b.textContent?.trim() === text,
  );
}

describe('CrossRepoTargetPickerComponent', () => {
  let fixture: ComponentFixture<CrossRepoTargetPickerComponent>;
  let fakeScopesGateway: ReturnType<typeof CreateFakeScopesGateway>;
  let fakeEnvironmentsGateway: ReturnType<typeof CreateFakeEnvironmentsGateway>;
  let fakeLedgerGateway: ReturnType<typeof CreateFakeLedgerGateway>;

  beforeEach(async () => {
    SeedFakeSession();

    fakeScopesGateway = CreateFakeScopesGateway();
    fakeScopesGateway.ListMyOrgs.and.resolveTo([{ login: 'other-org', avatarUrl: '' }]);
    fakeScopesGateway.ListMyRepos.and.resolveTo([
      { id: 2, name: 'other-repo', fullName: 'other-org/other-repo', owner: 'other-org', private: false },
    ]);
    fakeScopesGateway.GetAccountType.and.resolveTo('Organization');
    fakeScopesGateway.ListOrgRepos.and.resolveTo([]);

    fakeEnvironmentsGateway = CreateFakeEnvironmentsGateway();
    fakeEnvironmentsGateway.ListEnvironments.and.resolveTo([{ id: 1, name: 'staging' }]);

    fakeLedgerGateway = CreateFakeLedgerGateway();
    fakeLedgerGateway.GetLedger.and.resolveTo({ items: [], partialErrors: [], lockedSections: [], corruptedManifestScopes: [] });

    await TestBed.configureTestingModule({
      imports: [CrossRepoTargetPickerComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: SCOPES_GATEWAY, useValue: fakeScopesGateway },
        { provide: ENVIRONMENTS_GATEWAY, useValue: fakeEnvironmentsGateway },
        { provide: LEDGER_GATEWAY, useValue: fakeLedgerGateway },
        { provide: OAUTH_GATEWAY, useValue: CreateFakeOAuthGateway() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CrossRepoTargetPickerComponent);
    fixture.componentRef.setInput('item', SOURCE_VARIABLE);
    fixture.detectChanges();

    await WaitFor(fixture, () => {
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      return text.includes('other-org') && text.includes('other-org/other-repo');
    });
  });

  afterEach(() => ClearFakeSession());

  it('lists fetched organizations and repositories, filtered by the search query', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('other-org');
    expect(text).toContain('other-org/other-repo');

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'other-repo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const filteredText = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(filteredText).toContain('other-org/other-repo');
    expect(filteredText).not.toContain('Organizations');
  });

  it('reveals the environment select only once a repo is picked and its level is set to environment', async () => {
    expect(fixture.nativeElement.querySelectorAll('select').length).toBe(0);
    expect(fakeEnvironmentsGateway.ListEnvironments).not.toHaveBeenCalled();

    FindButton(fixture, 'other-org/other-repo')!.click();
    fixture.detectChanges();

    await WaitFor(fixture, () =>
      Array.from(fixture.nativeElement.querySelectorAll('option') as NodeListOf<HTMLOptionElement>).some(
        (o) => o.value === 'environment',
      ),
    );
    expect(fakeEnvironmentsGateway.ListEnvironments).toHaveBeenCalledWith('other-org', 'other-repo');
    expect(fixture.nativeElement.querySelectorAll('select').length).toBe(1);

    const levelSelect = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    levelSelect.value = 'environment';
    levelSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('select').length).toBe(2);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('staging');
  });

  it('does not fetch environments when only a bare organization is picked (no repo)', async () => {
    FindButton(fixture, 'other-org')!.click();
    fixture.detectChanges();

    await WaitFor(fixture, () => !!FindButton(fixture, 'Change'));
    expect(fakeEnvironmentsGateway.ListEnvironments).not.toHaveBeenCalled();
  });

  it('emits targetPicked with the picked organization-level scope once the destination ledger read resolves', async () => {
    const picked: CrossRepoTargetPicked[] = [];
    fixture.componentInstance.targetPicked.subscribe((t) => picked.push(t));

    FindButton(fixture, 'other-org')!.click();
    fixture.detectChanges();

    await WaitFor(fixture, () => !!FindButton(fixture, 'Change'));
    await WaitFor(fixture, () => {
      const addButton = FindButton(fixture, 'Add destination');
      return !!addButton && !addButton.disabled;
    });

    FindButton(fixture, 'Add destination')!.click();
    fixture.detectChanges();

    expect(fakeLedgerGateway.GetLedger).toHaveBeenCalledWith('other-org', undefined);
    expect(picked.length).toBe(1);
    expect(picked[0]).toEqual({ level: 'organization', scope: { org: 'other-org' }, options: undefined, existing: undefined });
  });
});
