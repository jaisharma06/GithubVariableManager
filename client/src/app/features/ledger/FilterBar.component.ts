import { Component, computed, input, output } from '@angular/core';
import type { GithubEnvironment, ItemKind } from '../../core/Types';
import type { LedgerFilters } from './LedgerFilters';

interface PillOption<T extends string> {
  value: T;
  label: string;
}

const KIND_OPTIONS: PillOption<ItemKind | 'all'>[] = [
  { value: 'all', label: 'All types' },
  { value: 'variable', label: 'Variables' },
  { value: 'secret', label: 'Secrets' },
];

/**
 * Port of web/src/features/ledger/FilterBar.tsx (the type/const half already lives in
 * LedgerFilters.ts — see that file's doc comment for why it was split out ahead of this
 * component). The React original's generic `Pills<T>` sub-component isn't ported 1:1 — with only
 * two call sites and no reuse beyond this file, a generic component would be unjustified
 * complexity (see docs/CodingStandards.md's "patterns must justify themselves" rule); both pill
 * groups are inlined in the template instead, sharing `PillClasses()`.
 */
@Component({
  selector: 'app-filter-bar',
  templateUrl: './FilterBar.component.html',
})
export class FilterBarComponent {
  readonly filters = input.required<LedgerFilters>();
  readonly environments = input<GithubEnvironment[]>([]);
  readonly showRepoLevels = input(false);
  readonly showOrgLevel = input(false);

  readonly filtersChange = output<LedgerFilters>();

  protected readonly kindOptions = KIND_OPTIONS;

  protected readonly levelOptions = computed<PillOption<LedgerFilters['level']>[]>(() => [
    { value: 'all', label: 'All levels' },
    ...(this.showOrgLevel() ? [{ value: 'organization' as const, label: 'Organization' }] : []),
    ...(this.showRepoLevels()
      ? [
          { value: 'repository' as const, label: 'Repository' },
          { value: 'environment' as const, label: 'Environment' },
        ]
      : []),
  ]);

  protected PillClasses(active: boolean): string {
    return `rounded px-2.5 py-1 font-sans text-xs font-medium transition-colors ${
      active ? 'bg-brand-dim text-brand' : 'text-text-dim hover:text-text'
    }`;
  }

  protected SetLevel(level: LedgerFilters['level']): void {
    this.filtersChange.emit({ ...this.filters(), level });
  }

  protected SetKind(kind: LedgerFilters['kind']): void {
    this.filtersChange.emit({ ...this.filters(), kind });
  }

  protected HandleEnvChange(event: Event): void {
    this.filtersChange.emit({ ...this.filters(), env: (event.target as HTMLSelectElement).value });
  }

  protected HandleSearchInput(event: Event): void {
    this.filtersChange.emit({ ...this.filters(), search: (event.target as HTMLInputElement).value });
  }
}
