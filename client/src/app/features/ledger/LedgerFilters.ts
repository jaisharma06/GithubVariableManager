// Port of the type/const half of web/src/features/ledger/FilterBar.tsx, split out ahead of
// FilterBar.component.ts (Phase 6) because DashboardShellComponent and ScopeSidebarComponent
// (Phase 5) already need the type — the sidebar's "scope tree" navigation writes to the same
// filters the ledger view will read. Phase 6's FilterBar.component.ts imports from here rather
// than redeclaring it.
import type { ItemKind, ItemLevel } from '../../core/Types';

export interface LedgerFilters {
  level: ItemLevel | 'all';
  kind: ItemKind | 'all';
  env: string | 'all';
  search: string;
}

export const DEFAULT_FILTERS: LedgerFilters = { level: 'all', kind: 'all', env: 'all', search: '' };
