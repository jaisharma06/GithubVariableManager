import { toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/AuthService';
import { LastScopeService } from '../../core/services/LastScopeService';
import { VariableClipboardService } from '../../core/services/VariableClipboardService';
import { EnvironmentsFacade } from '../../core/facades/EnvironmentsFacade';
import { ItemMutationsFacade } from '../../core/facades/ItemMutationsFacade';
import { LedgerFacade } from '../../core/facades/LedgerFacade';
import { FindComposites, FindDependents } from '../../core/facades/LedgerSupport';
import { ScopesFacade } from '../../core/facades/ScopesFacade';
import type { SyncAllTargetResult } from '../../core/gateways/ILedgerGateway';
import type { ItemLevel, LedgerItem } from '../../core/Types';
import type { DashboardScope } from '../../core/Types';
import { AvatarComponent } from '../../shared/components/Avatar.component';
import { ButtonComponent } from '../../shared/components/Button.component';
import { ConfirmDialogComponent } from '../../shared/components/ConfirmDialog.component';
import { RateLimitIndicatorComponent } from '../../shared/components/RateLimitIndicator.component';
import { CompareViewComponent } from '../compare/CompareView.component';
import { ItemEditorPanelComponent } from '../item-editor/ItemEditorPanel.component';
import { CopyItemDialogComponent } from '../ledger/CopyItemDialog.component';
import { LedgerComponent } from '../ledger/Ledger.component';
import { DEFAULT_FILTERS, type LedgerFilters } from '../ledger/LedgerFilters';
import { CopyEnvironmentDialogComponent } from './CopyEnvironmentDialog.component';
import { RenameEnvironmentDialogComponent, type EnvironmentRenamedEvent } from './RenameEnvironmentDialog.component';
import { RunnersPanelComponent } from './RunnersPanel.component';
import { ScopeSidebarComponent, type ScopeNavigateEvent } from './ScopeSidebar.component';
import { WorkflowsViewComponent } from '../workflows/WorkflowsView.component';

/**
 * What's being added/edited — mirrors web/src/features/dashboard/Dashboard.tsx's EditorState.
 * `name`/`value` on the 'create' variant are only ever populated by a paste (see
 * HandlePasteToSection below) — the plain "+ Add" flow never sets them.
 */
type EditorState =
  | { mode: 'create'; level?: ItemLevel; env?: string; name?: string; value?: string }
  | { mode: 'edit'; item: LedgerItem }
  | null;

/**
 * Port of web/src/features/dashboard/Dashboard.tsx (OrgDashboard/RepoDashboard/DashboardShell
 * combined into one routed component reading both possible param shapes). Every feature area is
 * now real: Ledger (Phase 6), the item editor + copy dialog (Phase 7, shared with CompareView),
 * and CompareView itself (Phase 8) behind the List/Compare toggle. CompareView owns its own
 * editor/copy/delete-row dialog state internally (matching the React original) rather than
 * bubbling those through this shell the way LedgerComponent's rows do.
 */
@Component({
  selector: 'app-dashboard-shell',
  imports: [
    ScopeSidebarComponent,
    RunnersPanelComponent,
    RenameEnvironmentDialogComponent,
    CopyEnvironmentDialogComponent,
    AvatarComponent,
    ButtonComponent,
    RateLimitIndicatorComponent,
    ConfirmDialogComponent,
    LedgerComponent,
    ItemEditorPanelComponent,
    CopyItemDialogComponent,
    CompareViewComponent,
    WorkflowsViewComponent,
  ],
  templateUrl: './DashboardShell.component.html',
})
export class DashboardShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly authService = inject(AuthService);
  private readonly lastScopeService = inject(LastScopeService);
  private readonly variableClipboardService = inject(VariableClipboardService);
  private readonly environmentsFacade = inject(EnvironmentsFacade);
  private readonly scopesFacade = inject(ScopesFacade);
  private readonly ledgerFacade = inject(LedgerFacade);
  private readonly itemMutationsFacade = inject(ItemMutationsFacade);

  // Angular reuses this component instance across '/o/:org' <-> '/r/:owner/:repo' navigations
  // that both resolve here, so scope has to come from the *reactive* paramMap, not a one-off
  // snapshot read at construction time — otherwise navigating from one scope straight to another
  // wouldn't update anything.
  private readonly paramMap = toSignal(this.route.paramMap, { requireSync: true });

  protected readonly scope = computed<DashboardScope>(() => {
    const params = this.paramMap();
    return { org: params.get('org') ?? params.get('owner') ?? '', repo: params.get('repo') ?? undefined };
  });
  protected readonly breadcrumb = computed<string[]>(() => {
    const s = this.scope();
    return s.repo ? [s.org, s.repo] : [s.org];
  });

  protected readonly environmentsQuery = this.environmentsFacade.EnvironmentsQuery(
    () => this.scope().org,
    () => this.scope().repo,
  );
  protected readonly isOrgAccountQuery = this.scopesFacade.IsOrgAccountQuery(() =>
    this.scope().repo ? this.scope().org : null,
  );
  protected readonly showOrgLevel = computed(() => !this.scope().repo || this.isOrgAccountQuery.data() === true);

  protected readonly ledgerQuery = this.ledgerFacade.LedgerQuery(this.scope);
  protected readonly ledgerItems = computed(() => this.ledgerQuery.data()?.items ?? []);
  protected readonly ledgerPartialErrors = computed(() => this.ledgerQuery.data()?.partialErrors ?? []);
  protected readonly ledgerLockedSections = computed(() => this.ledgerQuery.data()?.lockedSections ?? []);
  protected readonly ledgerCorruptedManifestScopes = computed(() => this.ledgerQuery.data()?.corruptedManifestScopes ?? []);

  protected readonly filters = signal<LedgerFilters>(DEFAULT_FILTERS);
  protected readonly envToDelete = signal<string | null>(null);
  protected readonly envDeleteError = signal<string | null>(null);
  protected readonly envToRename = signal<string | null>(null);
  protected readonly envToCopy = signal<string | null>(null);
  protected readonly viewMode = signal<'list' | 'compare' | 'workflows'>('list');
  protected readonly editorState = signal<EditorState>(null);
  protected readonly copyTarget = signal<LedgerItem | null>(null);
  protected readonly deleteTarget = signal<LedgerItem | null>(null);
  protected readonly deleteError = signal<string | null>(null);
  protected readonly exporting = signal(false);
  protected readonly exportError = signal<string | null>(null);
  /** Sync (composite-variable support) — `LedgerFacade.syncVariable`, `POST /api/ledger/variables/sync`. Replaces the old "flatten to literal" action 1:1. */
  protected readonly syncTarget = signal<LedgerItem | null>(null);
  protected readonly syncError = signal<string | null>(null);
  /**
   * The global "Sync all" action — `LedgerFacade.syncAllVariables`, `POST /api/ledger/variables/sync-all`.
   * `syncAllOpen` gates the whole flow (confirm step, then results step); `syncAllResult` being set
   * is what switches the dialog from the confirm prompt to the three-bucket results view — null
   * while still on the confirm step, non-null (even an empty array in principle) once the mutation
   * has resolved. `syncAllRefreshing` covers the step before any of that: `HandleSyncAll` re-fetches
   * the ledger first (see its doc comment) so `syncAllTargets` below is built from what's actually
   * composite right now, not from `ledgerItems()`'s possibly-stale cached snapshot at click time.
   */
  protected readonly syncAllOpen = signal(false);
  protected readonly syncAllResult = signal<SyncAllTargetResult[] | null>(null);
  protected readonly syncAllError = signal<string | null>(null);
  protected readonly syncAllRefreshing = signal(false);

  // environmentsFacade/itemMutationsFacade themselves stay private (DI dependencies aren't part
  // of this component's template-facing API) — just their pending signals are re-exposed for the
  // confirm dialogs.
  protected readonly envDeletePending = this.environmentsFacade.deleteEnvironment.isPending;
  protected readonly envDeleteTitle = computed(() => `Delete environment "${this.envToDelete()}"?`);
  protected readonly deleteItemPending = computed(
    () => this.itemMutationsFacade.deleteVariable.isPending() || this.itemMutationsFacade.deleteSecret.isPending(),
  );
  protected readonly deleteItemTitle = computed(() => {
    const target = this.deleteTarget();
    return target ? `Delete ${target.kind === 'variable' ? 'variable' : 'secret'} "${target.name}"?` : '';
  });
  /** Reverse-dependency warning — other composite variables (in scope-chain reach) that reference the item about to be deleted, so deleting it doesn't silently break them. */
  protected readonly deleteItemDependents = computed(() => {
    const target = this.deleteTarget();
    return target ? FindDependents(this.ledgerItems(), target.name, target.scope) : [];
  });
  protected readonly syncPending = this.ledgerFacade.syncVariable.isPending;
  protected readonly syncTitle = computed(() => {
    const target = this.syncTarget();
    return target ? `Sync "${target.name}" to its current resolved value?` : '';
  });

  /** Client-computed target list for "Sync all" — see `LedgerSupport.FindComposites`'s doc comment for why this isn't a server-side enumeration. */
  protected readonly syncAllTargets = computed(() =>
    FindComposites(this.ledgerItems()).map((item) => ({ scope: item.scope, level: item.level, name: item.name })),
  );
  protected readonly syncAllTitle = computed(() => {
    const n = this.syncAllTargets().length;
    return `Sync all ${n} composite variable${n === 1 ? '' : 's'}?`;
  });
  protected readonly syncAllPending = this.ledgerFacade.syncAllVariables.isPending;
  protected readonly syncAllSynced = computed(() => (this.syncAllResult() ?? []).filter((r) => r.ok && r.synced));
  protected readonly syncAllAlreadyCurrent = computed(() => (this.syncAllResult() ?? []).filter((r) => r.ok && !r.synced));
  protected readonly syncAllFailed = computed(() => (this.syncAllResult() ?? []).filter((r) => !r.ok));

  constructor() {
    effect(() => {
      const s = this.scope();
      const label = this.breadcrumb().join(' / ');
      const path = s.repo ? `/r/${s.org}/${s.repo}` : `/o/${s.org}`;
      this.lastScopeService.SetLastScope({ path, label });
    });
  }

  protected HandleSidebarNavigate(event: ScopeNavigateEvent): void {
    if (event.level === 'all') {
      this.filters.set(DEFAULT_FILTERS);
    } else {
      this.filters.update((f) => ({ ...f, level: event.level, env: event.env ?? 'all' }));
    }
  }

  protected async HandleConfirmDeleteEnv(): Promise<void> {
    const name = this.envToDelete();
    const repo = this.scope().repo;
    if (!name || !repo) return;
    this.envDeleteError.set(null);
    try {
      await this.environmentsFacade.deleteEnvironment.mutateAsync({ org: this.scope().org, repo, name });
      this.envToDelete.set(null);
    } catch (err) {
      this.envDeleteError.set(err instanceof Error ? err.message : 'GitHub rejected this request.');
    }
  }

  protected HandleCancelDeleteEnv(): void {
    this.envToDelete.set(null);
    this.envDeleteError.set(null);
  }

  protected HandleEnvironmentRenamed(event: EnvironmentRenamedEvent): void {
    this.filters.update((f) => (f.env === event.oldName ? { ...f, env: event.newName } : f));
    this.envToRename.set(null);
  }

  protected HandleAdd(): void {
    this.editorState.set({ mode: 'create' });
  }

  protected HandleAddToSection(event: { level: ItemLevel; env?: string }): void {
    this.editorState.set({ mode: 'create', level: event.level, env: event.env });
  }

  /** Opens the create form pre-filled from the clipboard buffer — a no-op if it's empty (the paste affordance is hidden in that case, but this stays defensive). */
  protected HandlePasteToSection(event: { level: ItemLevel; env?: string }): void {
    const clip = this.variableClipboardService.clipboard();
    if (!clip) return;
    this.editorState.set({ mode: 'create', level: event.level, env: event.env, name: clip.name, value: clip.value });
  }

  protected HandleEditItem(item: LedgerItem): void {
    this.editorState.set({ mode: 'edit', item });
  }

  protected async HandleConfirmDeleteItem(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;
    this.deleteError.set(null);
    const params = { scope: target.scope, level: target.level, name: target.name };
    try {
      if (target.kind === 'variable') await this.itemMutationsFacade.deleteVariable.mutateAsync(params);
      else await this.itemMutationsFacade.deleteSecret.mutateAsync(params);
      this.deleteTarget.set(null);
    } catch (err) {
      this.deleteError.set(err instanceof Error ? err.message : 'GitHub rejected this request.');
    }
  }

  protected HandleCancelDeleteItem(): void {
    this.deleteTarget.set(null);
    this.deleteError.set(null);
  }

  protected DependentScopeLabel(item: LedgerItem): string {
    return item.level === 'environment' ? `environment: ${item.scope.env}` : item.level;
  }

  protected HandleSyncItem(item: LedgerItem): void {
    this.syncError.set(null);
    this.syncTarget.set(item);
  }

  /**
   * Re-reads the formula from this item's scope manifest and recomputes it against current sibling
   * values, overwriting the real GitHub value in place — `POST /api/ledger/variables/sync`. No
   * `resolvedValue` needed client-side at all anymore; the server looks the formula up itself.
   * Still sits behind ConfirmDialogComponent (a routine but real write), not fired straight from
   * LedgerRowComponent's icon click.
   */
  protected async HandleConfirmSyncItem(): Promise<void> {
    const target = this.syncTarget();
    if (!target) return;
    this.syncError.set(null);
    try {
      await this.ledgerFacade.syncVariable.mutateAsync({ scope: target.scope, level: target.level, name: target.name });
      this.syncTarget.set(null);
    } catch (err) {
      this.syncError.set(err instanceof Error ? err.message : 'GitHub rejected this request.');
    }
  }

  protected HandleCancelSyncItem(): void {
    this.syncTarget.set(null);
    this.syncError.set(null);
  }

  /**
   * Re-fetches the ledger before opening the confirm dialog, so "Sync all" resolves every
   * variable's current composite-ness/formula fresh and only then decides what to sync — not
   * whichever items `ledgerItems()` happened to hold at click time (which could be up to the
   * query's `staleTime` old, or older still if a composite was just created/edited in another tab).
   * `syncAllTargets` below is a `computed` off `ledgerItems()`, so once this refetch's result lands
   * in the query cache, the confirm dialog's title/target list reflect it automatically — no
   * separate "fresh targets" plumbing needed. A failed refresh doesn't block opening the dialog
   * (the last-known items are still shown, same as any other refetch failure in this app); it's
   * surfaced via `syncAllError` so the user can see the list may be stale before confirming.
   */
  protected async HandleSyncAll(): Promise<void> {
    this.syncAllError.set(null);
    this.syncAllResult.set(null);
    this.syncAllRefreshing.set(true);
    try {
      const result = await this.ledgerQuery.refetch();
      if (result.isError) {
        const message = result.error instanceof Error ? result.error.message : 'GitHub rejected this request.';
        this.syncAllError.set(`Couldn't refresh before syncing — the list below may be out of date: ${message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'GitHub rejected this request.';
      this.syncAllError.set(`Couldn't refresh before syncing — the list below may be out of date: ${message}`);
    } finally {
      this.syncAllRefreshing.set(false);
    }
    this.syncAllOpen.set(true);
  }

  /**
   * Runs the batch sync and switches this dialog from the confirm prompt to the results view —
   * `syncAllOpen` stays true throughout so the dialog doesn't flash closed between the two steps.
   */
  protected async HandleConfirmSyncAll(): Promise<void> {
    this.syncAllError.set(null);
    try {
      const results = await this.ledgerFacade.syncAllVariables.mutateAsync(this.syncAllTargets());
      this.syncAllResult.set(results);
    } catch (err) {
      this.syncAllError.set(err instanceof Error ? err.message : 'GitHub rejected this request.');
    }
  }

  protected HandleCloseSyncAll(): void {
    this.syncAllOpen.set(false);
    this.syncAllResult.set(null);
    this.syncAllError.set(null);
  }

  /** Comma-joined names for one outcome bucket's summary line — mirrors `CopyEnvironmentDialogComponent`'s `result()!.copied.join(', ')` precedent for a plain string array; these results carry richer objects, so this collapses them to just the name first. */
  protected SyncAllNames(results: SyncAllTargetResult[]): string {
    return results.map((r) => r.target.name).join(', ');
  }

  protected HandleDisconnect(): void {
    this.authService.SignOut();
    void this.router.navigateByUrl('/connect');
  }

  protected async HandleExport(): Promise<void> {
    this.exportError.set(null);
    this.exporting.set(true);
    try {
      const { blob, filename } = await this.ledgerFacade.ExportLedger(this.scope().org, this.scope().repo);
      this.TriggerDownload(blob, filename);
    } catch (err) {
      this.exportError.set(err instanceof Error ? err.message : 'GitHub rejected this request.');
    } finally {
      this.exporting.set(false);
    }
  }

  private TriggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
