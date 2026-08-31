import { Component, computed, inject, input, signal } from '@angular/core';
import { DeleteEverywhereFacade } from '../../core/facades/DeleteEverywhereFacade';
import { FindDependents } from '../../core/facades/LedgerSupport';
import type { DashboardScope, GithubEnvironment, ItemKind, ItemLevel, LedgerItem, ScopeRef } from '../../core/Types';
import { ConfirmDialogComponent } from '../../shared/components/ConfirmDialog.component';
import { CopyItemDialogComponent } from '../ledger/CopyItemDialog.component';
import { ItemEditorPanelComponent } from '../item-editor/ItemEditorPanel.component';

interface Column {
  key: string;
  label: string;
  level: ItemLevel;
  scope: ScopeRef;
}

interface Row {
  kind: ItemKind;
  name: string;
  cells: Map<string, LedgerItem>;
}

interface EditTarget {
  item: LedgerItem | null;
  column: Column;
  name: string;
  kind: ItemKind;
}

interface DeleteRowTarget {
  kind: ItemKind;
  name: string;
  targets: { level: ItemLevel; scope: ScopeRef; label: string }[];
}

function ColumnKeyFor(level: ItemLevel, env?: string): string {
  return level === 'environment' ? `env:${env}` : level;
}

/**
 * Port of web/src/features/compare/CompareView.tsx. Unlike LedgerComponent (which bubbles add/
 * edit/copy/delete up to DashboardShellComponent via outputs), this component owns its own
 * editor/copy/delete-row dialog state and renders ItemEditorPanelComponent/CopyItemDialogComponent/
 * ConfirmDialogComponent directly — matching the React original's architecture exactly. Row
 * delete removes a name from *every* scope it's set in (DeleteEverywhereFacade), which is a
 * different operation from LedgerRowComponent's single-scope delete.
 */
@Component({
  selector: 'app-compare-view',
  imports: [ItemEditorPanelComponent, CopyItemDialogComponent, ConfirmDialogComponent],
  templateUrl: './CompareView.component.html',
})
export class CompareViewComponent {
  readonly scope = input.required<DashboardScope>();
  readonly environments = input<GithubEnvironment[]>([]);
  readonly items = input<LedgerItem[]>([]);
  readonly showOrgLevel = input.required<boolean>();
  readonly isLoading = input(false);
  readonly error = input<Error | null>(null);

  private readonly deleteEverywhereFacade = inject(DeleteEverywhereFacade);

  protected readonly kindFilterOptions: (ItemKind | 'all')[] = ['all', 'variable', 'secret'];

  protected readonly columns = computed<Column[]>(() => {
    const s = this.scope();
    const cols: Column[] = [];
    if (this.showOrgLevel()) {
      cols.push({ key: 'organization', label: `Org · ${s.org}`, level: 'organization', scope: { org: s.org } });
    }
    if (s.repo) {
      cols.push({ key: 'repository', label: `Repo · ${s.repo}`, level: 'repository', scope: { org: s.org, repo: s.repo } });
      for (const env of this.environments()) {
        cols.push({
          key: `env:${env.name}`,
          label: env.name,
          level: 'environment',
          scope: { org: s.org, repo: s.repo, env: env.name },
        });
      }
    }
    return cols;
  });

  // Org/repo-level vars & secrets apply everywhere already — default the comparison to just the
  // environments, where values are most likely to actually differ. Still one click away.
  protected readonly deselected = signal<Set<string>>(new Set(['organization', 'repository']));
  protected readonly kindFilter = signal<ItemKind | 'all'>('all');
  protected readonly search = signal('');
  protected readonly hideValues = signal(false);

  protected readonly editTarget = signal<EditTarget | null>(null);
  protected readonly copySource = signal<LedgerItem | null>(null);
  protected readonly deleteRow = signal<DeleteRowTarget | null>(null);
  protected readonly deleteError = signal<string | null>(null);

  protected readonly visibleColumns = computed(() => this.columns().filter((c) => !this.deselected().has(c.key)));
  private readonly visibleKeys = computed(() => new Set(this.visibleColumns().map((c) => c.key)));

  protected readonly rows = computed<Row[]>(() => {
    const map = new Map<string, Row>();
    const visibleKeys = this.visibleKeys();
    const kindFilter = this.kindFilter();
    const search = this.search().toLowerCase();
    for (const item of this.items()) {
      const colKey = ColumnKeyFor(item.level, item.scope.env);
      if (!visibleKeys.has(colKey)) continue;
      if (kindFilter !== 'all' && item.kind !== kindFilter) continue;
      if (search && !item.name.toLowerCase().includes(search)) continue;
      const rowKey = `${item.kind}:${item.name}`;
      let row = map.get(rowKey);
      if (!row) {
        row = { kind: item.kind, name: item.name, cells: new Map() };
        map.set(rowKey, row);
      }
      row.cells.set(colKey, item);
    }
    return [...map.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'variable' ? -1 : 1));
  });

  protected readonly deleteRowTitle = computed(() => {
    const target = this.deleteRow();
    return target ? `Delete "${target.name}" from all ${target.targets.length} scopes?` : '';
  });
  protected readonly deletePending = this.deleteEverywhereFacade.isPending;
  /**
   * Reverse-dependency warning across every scope this row is being deleted from — deduped by
   * item id, since a wide delete can otherwise surface the same dependent once per matching scope.
   * Secrets can never be referenced by a composite formula (see docs/Architecture.md), so this is
   * a no-op for a secret row.
   */
  protected readonly deleteRowDependents = computed<LedgerItem[]>(() => {
    const target = this.deleteRow();
    if (!target || target.kind !== 'variable') return [];
    const dependents = new Map<string, LedgerItem>();
    for (const t of target.targets) {
      for (const dep of FindDependents(this.items(), target.name, t.scope)) dependents.set(dep.id, dep);
    }
    return [...dependents.values()];
  });

  protected KindFilterLabel(kind: ItemKind | 'all'): string {
    return kind === 'all' ? 'All types' : kind === 'variable' ? 'Variables' : 'Secrets';
  }

  protected KindPillClasses(kind: ItemKind | 'all'): string {
    const active = this.kindFilter() === kind;
    return `rounded px-2.5 py-1 font-sans text-xs font-medium transition-colors ${
      active ? 'bg-brand-dim text-brand' : 'text-text-dim hover:text-text'
    }`;
  }

  protected ColumnPillClasses(key: string): string {
    const hidden = this.deselected().has(key);
    return `rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
      hidden ? 'border-line text-text-dim/50 line-through hover:text-text-dim' : 'border-brand/40 bg-brand-dim text-brand'
    }`;
  }

  protected ColumnToggleTitle(column: Column): string {
    return this.deselected().has(column.key) ? `Show ${column.label}` : `Hide ${column.label}`;
  }

  protected DeleteRowButtonTitle(name: string): string {
    return `Delete "${name}" from every scope it's set in`;
  }

  protected ToggleColumn(key: string): void {
    this.deselected.update((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected HandleSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  private FullOccurrences(kind: ItemKind, name: string): { level: ItemLevel; scope: ScopeRef; label: string }[] {
    const columns = this.columns();
    return this.items()
      .filter((i) => i.kind === kind && i.name === name)
      .map((i) => {
        const col = columns.find((c) => c.key === ColumnKeyFor(i.level, i.scope.env));
        return { level: i.level, scope: i.scope, label: col?.label ?? i.level };
      });
  }

  protected OpenDeleteRow(row: Row): void {
    this.deleteRow.set({ kind: row.kind, name: row.name, targets: this.FullOccurrences(row.kind, row.name) });
  }

  protected OpenEditCell(row: Row, column: Column, cell: LedgerItem | null): void {
    this.editTarget.set({ item: cell, column, name: row.name, kind: row.kind });
  }

  protected async HandleConfirmDelete(): Promise<void> {
    const target = this.deleteRow();
    if (!target) return;
    this.deleteError.set(null);
    const outcome = await this.deleteEverywhereFacade.DeleteFrom(target.kind, target.name, target.targets);
    const failed = outcome.filter((r) => !r.ok);
    if (failed.length === 0) {
      this.deleteRow.set(null);
    } else {
      this.deleteError.set(`Failed for ${failed.length} of ${outcome.length}: ${failed.map((f) => f.message).join('; ')}`);
    }
  }

  protected HandleCancelDelete(): void {
    this.deleteRow.set(null);
    this.deleteError.set(null);
  }
}
