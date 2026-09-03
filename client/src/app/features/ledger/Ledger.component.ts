import { Component, computed, input, output, signal } from '@angular/core';
import { FindComposites, type LedgerLockedSection, type LedgerPartialError } from '../../core/facades/LedgerSupport';
import type { GithubEnvironment, ItemKind, ItemLevel, LedgerItem } from '../../core/Types';
import { ButtonComponent } from '../../shared/components/Button.component';
import { FilterBarComponent } from './FilterBar.component';
import type { LedgerFilters } from './LedgerFilters';
import { LedgerRowComponent, ROW_GRID } from './LedgerRow.component';
import { SectionHeaderComponent } from './SectionHeader.component';

interface Group {
  key: string;
  level: ItemLevel;
  scopeLabel: string;
  description: string;
  env?: string;
  items: LedgerItem[];
  lockedKinds: ItemKind[];
}

const LEVEL_INDENT: Record<ItemLevel, string> = {
  organization: 'ml-0',
  repository: 'ml-5',
  environment: 'ml-10',
};

const LEVEL_ORDER: Record<ItemLevel, number> = { organization: 0, repository: 1, environment: 2 };

function GroupKeyFor(level: ItemLevel, env?: string): string {
  return level === 'environment' ? `env:${env}` : level;
}

function DescriptionFor(level: ItemLevel, scopeLabel: string, env?: string): string {
  if (level === 'organization') return `Shared with every repo in ${scopeLabel}.`;
  if (level === 'repository') return 'Only this repo can use these.';
  return `Only deployments to "${env}" can use these.`;
}

function GroupItems(items: LedgerItem[], locked: LedgerLockedSection[]): Group[] {
  const groups = new Map<string, Group>();

  function EnsureGroup(level: ItemLevel, scopeLabel: string, env?: string): Group {
    const key = GroupKeyFor(level, env);
    let group = groups.get(key);
    if (!group) {
      group = { key, level, scopeLabel, description: DescriptionFor(level, scopeLabel, env), env, items: [], lockedKinds: [] };
      groups.set(key, group);
    }
    return group;
  }

  for (const item of items) {
    const scopeLabel =
      item.level === 'organization' ? item.scope.org : item.level === 'repository' ? item.scope.repo! : item.scope.env!;
    EnsureGroup(item.level, scopeLabel, item.scope.env).items.push(item);
  }

  for (const l of locked) {
    const group = EnsureGroup(l.level, l.scopeLabel, l.env);
    if (!group.lockedKinds.includes(l.kind)) group.lockedKinds.push(l.kind);
  }

  return [...groups.values()]
    .map((g) => ({
      ...g,
      items: [...g.items].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'variable' ? -1 : 1)),
    }))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.scopeLabel.localeCompare(b.scopeLabel));
}

/**
 * Port of web/src/features/ledger/Ledger.tsx. Grouping/filtering (GroupItems etc.) stays as free
 * functions in this file rather than moving into a Facade — it's pure presentation shaping of
 * already-fetched data, not a server-cache or business-rule concern, matching where the React
 * original keeps it too. `hideValues` is local UI state (not part of LedgerFilters) for the same
 * reason it is in the original: it's a display toggle, not a filter that changes which items match.
 */
@Component({
  selector: 'app-ledger',
  imports: [FilterBarComponent, ButtonComponent, SectionHeaderComponent, LedgerRowComponent],
  templateUrl: './Ledger.component.html',
})
export class LedgerComponent {
  readonly items = input.required<LedgerItem[]>();
  readonly isLoading = input(false);
  readonly error = input<Error | null>(null);
  readonly partialErrors = input<LedgerPartialError[]>([]);
  readonly lockedSections = input<LedgerLockedSection[]>([]);
  readonly environments = input<GithubEnvironment[]>([]);
  readonly showRepoLevels = input(false);
  readonly showOrgLevel = input(false);
  readonly filters = input.required<LedgerFilters>();

  readonly filtersChange = output<LedgerFilters>();
  readonly add = output<void>();
  readonly addToSection = output<{ level: ItemLevel; env?: string }>();
  readonly pasteToSection = output<{ level: ItemLevel; env?: string }>();
  readonly editItem = output<LedgerItem>();
  readonly copyItem = output<LedgerItem>();
  readonly deleteItem = output<LedgerItem>();
  readonly syncItem = output<LedgerItem>();
  /** The global "Sync all" action — re-syncs every composite variable across the currently-open ledger in one batch call. See `hasComposites` below for when the button that fires this is shown. */
  readonly syncAll = output<void>();

  protected readonly rowGrid = ROW_GRID;
  protected readonly hideValues = signal(false);
  /**
   * Whether to show the "Sync all" button at all — hidden, not disabled, when there are no
   * composite variables in scope, matching `SectionHeaderComponent.hasClipboard`'s established
   * precedent for a conditionally-shown toolbar action. Deliberately keyed on compositeness
   * existing at all, not on whether anything is currently stale — an all-already-current batch is a
   * legitimate, calm no-op outcome, not a reason to hide the button (this also avoids the button
   * flickering in and out as staleness changes turn-by-turn).
   */
  protected readonly hasComposites = computed(() => FindComposites(this.items()).length > 0);

  private readonly filtered = computed(() =>
    this.items().filter((item) => {
      const f = this.filters();
      if (f.level !== 'all' && item.level !== f.level) return false;
      if (f.kind !== 'all' && item.kind !== f.kind) return false;
      if (f.env !== 'all' && item.scope.env !== f.env) return false;
      if (f.search && !item.name.toLowerCase().includes(f.search.toLowerCase())) return false;
      return true;
    }),
  );

  private readonly filteredLocked = computed(() => {
    const f = this.filters();
    if (f.search) return [];
    return this.lockedSections().filter((l) => {
      if (f.level !== 'all' && l.level !== f.level) return false;
      if (f.kind !== 'all' && l.kind !== f.kind) return false;
      if (f.env !== 'all' && l.env !== f.env) return false;
      return true;
    });
  });

  protected readonly groups = computed(() => GroupItems(this.filtered(), this.filteredLocked()));

  protected LevelIndent(level: ItemLevel): string {
    return LEVEL_INDENT[level];
  }

  protected ToggleHideValues(): void {
    this.hideValues.update((v) => !v);
  }
}
