import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { LedgerLockedSection, LedgerPartialError } from '../../core/facades/LedgerSupport';
import type { GithubEnvironment, LedgerItem } from '../../core/Types';
import { DEFAULT_FILTERS, type LedgerFilters } from './LedgerFilters';
import { LedgerComponent } from './Ledger.component';

interface FixtureOverrides {
  items?: LedgerItem[];
  isLoading?: boolean;
  error?: Error | null;
  partialErrors?: LedgerPartialError[];
  lockedSections?: LedgerLockedSection[];
  environments?: GithubEnvironment[];
  showRepoLevels?: boolean;
  showOrgLevel?: boolean;
  filters?: LedgerFilters;
}

describe('LedgerComponent', () => {
  let fixture: ComponentFixture<LedgerComponent>;

  const REPO_VAR: LedgerItem = {
    id: 'variable:repository:acme-corp:widgets::API_URL',
    kind: 'variable',
    level: 'repository',
    scope: { org: 'acme-corp', repo: 'widgets' },
    name: 'API_URL',
    value: 'https://example.com',
    createdAt: '',
    updatedAt: '',
  };

  const ENV_SECRET: LedgerItem = {
    id: 'secret:environment:acme-corp:widgets:staging:TOKEN',
    kind: 'secret',
    level: 'environment',
    scope: { org: 'acme-corp', repo: 'widgets', env: 'staging' },
    name: 'TOKEN',
    createdAt: '',
    updatedAt: '',
  };

  async function CreateFixture(overrides: FixtureOverrides = {}): Promise<ComponentFixture<LedgerComponent>> {
    await TestBed.configureTestingModule({ imports: [LedgerComponent] }).compileComponents();
    const f = TestBed.createComponent(LedgerComponent);
    f.componentRef.setInput('items', overrides.items ?? [REPO_VAR, ENV_SECRET]);
    f.componentRef.setInput('isLoading', overrides.isLoading ?? false);
    f.componentRef.setInput('error', overrides.error ?? null);
    f.componentRef.setInput('partialErrors', overrides.partialErrors ?? []);
    f.componentRef.setInput('lockedSections', overrides.lockedSections ?? []);
    f.componentRef.setInput('environments', overrides.environments ?? [{ id: 1, name: 'staging' }]);
    f.componentRef.setInput('showRepoLevels', overrides.showRepoLevels ?? true);
    f.componentRef.setInput('showOrgLevel', overrides.showOrgLevel ?? false);
    f.componentRef.setInput('filters', overrides.filters ?? DEFAULT_FILTERS);
    f.detectChanges();
    return f;
  }

  it('shows a loading skeleton while isLoading is true', async () => {
    fixture = await CreateFixture({ isLoading: true });
    expect(fixture.nativeElement.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows the error message when error is set', async () => {
    fixture = await CreateFixture({ isLoading: false, error: new Error('Rate limited') });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Rate limited');
  });

  it('shows an empty-state message when there are no items', async () => {
    fixture = await CreateFixture({ items: [] });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No variables or secrets set here yet');
  });

  it('groups items by level/scope with section headers, and renders locked sections', async () => {
    fixture = await CreateFixture({
      lockedSections: [{ level: 'repository', kind: 'secret', scopeLabel: 'widgets' } satisfies LedgerLockedSection],
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Repository');
    expect(text).toContain('widgets');
    expect(text).toContain('Environment');
    expect(text).toContain('staging');
    expect(text).toContain('API_URL');
    expect(text).toContain('TOKEN');
    expect(text).toContain('No access to view secrets at this level.');
  });

  it('shows the partial-errors banner when set', async () => {
    fixture = await CreateFixture({
      partialErrors: [{ label: 'organization variables', message: 'Forbidden (HTTP 403)' } satisfies LedgerPartialError],
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("Couldn’t load one part of this scope");
    expect(text).toContain('organization variables');
  });

  it('toggles hideValues and masks variable values when clicked', async () => {
    fixture = await CreateFixture();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('https://example.com');

    const toggle = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) =>
      b.textContent?.includes('Hide values'),
    )!;
    toggle.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('https://example.com');
  });

  it('emits editItem/copyItem/deleteItem with the clicked item', async () => {
    fixture = await CreateFixture();
    const editSpy = jasmine.createSpy('editItem');
    const copySpy = jasmine.createSpy('copyItem');
    const deleteSpy = jasmine.createSpy('deleteItem');
    fixture.componentInstance.editItem.subscribe(editSpy);
    fixture.componentInstance.copyItem.subscribe(copySpy);
    fixture.componentInstance.deleteItem.subscribe(deleteSpy);

    const editButton = fixture.nativeElement.querySelector('[title="Edit"]') as HTMLButtonElement;
    editButton.click();

    expect(editSpy).toHaveBeenCalledWith(REPO_VAR);
    expect(copySpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('emits add and addToSection', async () => {
    fixture = await CreateFixture();
    const addSpy = jasmine.createSpy('add');
    const addToSectionSpy = jasmine.createSpy('addToSection');
    fixture.componentInstance.add.subscribe(addSpy);
    fixture.componentInstance.addToSection.subscribe(addToSectionSpy);

    const addButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === '+ Add' && b.closest('app-section-header') === null,
    )!;
    addButton.click();
    expect(addSpy).toHaveBeenCalled();

    const sectionAddButton = fixture.nativeElement.querySelector('app-section-header button') as HTMLButtonElement;
    sectionAddButton.click();
    expect(addToSectionSpy).toHaveBeenCalledWith({ level: 'repository', env: undefined });
  });

  it('hides the "Sync all" button when there are no composite variables', async () => {
    fixture = await CreateFixture();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
    expect(buttons.some((b) => b.textContent?.trim() === 'Sync all')).toBe(false);
  });

  it('shows the "Sync all" button and emits syncAll when clicked, once a composite variable is in scope', async () => {
    const compositeItem: LedgerItem = { ...REPO_VAR, id: 'variable:repository:acme-corp:widgets::CDN', name: 'CDN', formula: '$(API_URL)/cdn' };
    fixture = await CreateFixture({ items: [REPO_VAR, compositeItem] });
    const syncAllSpy = jasmine.createSpy('syncAll');
    fixture.componentInstance.syncAll.subscribe(syncAllSpy);

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
    const syncAllButton = buttons.find((b) => b.textContent?.trim() === 'Sync all')!;
    expect(syncAllButton).toBeTruthy();

    syncAllButton.click();
    expect(syncAllSpy).toHaveBeenCalled();
  });

  it('propagates filtersChange from the FilterBar', async () => {
    fixture = await CreateFixture();
    const changeSpy = jasmine.createSpy('filtersChange');
    fixture.componentInstance.filtersChange.subscribe(changeSpy);

    const searchInput = fixture.nativeElement.querySelector('app-filter-bar input') as HTMLInputElement;
    searchInput.value = 'API_URL';
    searchInput.dispatchEvent(new Event('input'));

    expect(changeSpy).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, search: 'API_URL' });
  });
});
