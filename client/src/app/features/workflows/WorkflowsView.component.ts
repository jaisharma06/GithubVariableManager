import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { WorkflowsFacade } from '../../core/facades/WorkflowsFacade';
import type { GithubWorkflow, WorkflowRun } from '../../core/Types';
import { ConfirmDialogComponent } from '../../shared/components/ConfirmDialog.component';
import { PermissionAwareMessage } from './WorkflowRunMessages';
import { WorkflowRunDetailPanelComponent } from './WorkflowRunDetailPanel.component';
import { WorkflowRunsListComponent } from './WorkflowRunsList.component';

const STATE_LABELS: Record<GithubWorkflow['state'], string> = {
  active: 'Active',
  deleted: 'Deleted',
  disabled_fork: 'Disabled (fork)',
  disabled_inactivity: 'Disabled (inactive)',
  disabled_manually: 'Disabled',
};

/**
 * Browse a repo's Actions workflows, view a selected workflow's latest runs, and bulk-delete a
 * checkbox-selected set of them. Owns its own selection/dialog state internally rather than
 * bubbling it up to DashboardShellComponent — same rationale as CompareViewComponent (see
 * features/compare/README.md): which workflow is selected, which runs are checked, and whether the
 * delete confirmation is open are all purely local to this view, with no reason to live one level
 * up.
 */
@Component({
  selector: 'app-workflows-view',
  imports: [ConfirmDialogComponent, WorkflowRunDetailPanelComponent, WorkflowRunsListComponent],
  templateUrl: './WorkflowsView.component.html',
})
export class WorkflowsViewComponent {
  readonly org = input.required<string>();
  readonly repo = input.required<string>();

  private readonly workflowsFacade = inject(WorkflowsFacade);

  protected readonly workflowsQuery = this.workflowsFacade.WorkflowsQuery(
    () => this.org(),
    () => this.repo(),
  );
  protected readonly workflows = computed(() => this.workflowsQuery.data() ?? []);

  protected readonly selectedWorkflowId = signal<number | null>(null);
  protected readonly selectedWorkflow = computed(() => this.workflows().find((w) => w.id === this.selectedWorkflowId()) ?? null);

  protected readonly runsQuery = this.workflowsFacade.WorkflowRunsQuery(
    () => this.org(),
    () => this.repo(),
    () => this.selectedWorkflowId(),
  );
  protected readonly runs = computed(() => this.runsQuery.data() ?? []);

  protected readonly deletingRunId = signal<number | null>(null);
  protected readonly runDeleteError = signal<string | null>(null);

  /**
   * The run currently opened for detail viewing, if any. Everything else about the detail view —
   * the jobs/steps query, the rerun mutation, which jobs are expanded — belongs to
   * WorkflowRunDetailPanelComponent, matching how CopyItemDialogComponent owns its own facade work
   * rather than having it threaded down from its host.
   */
  protected readonly selectedRunForDetail = signal<WorkflowRun | null>(null);

  /** Ids of runs checked for bulk delete — scoped to the currently-displayed page of runs. */
  protected readonly selectedRunIds = signal<Set<number>>(new Set());

  protected readonly confirmDelete = signal<GithubWorkflow | null>(null);
  protected readonly deleteProgress = signal<{ done: number; total: number } | null>(null);
  protected readonly deleteError = signal<string | null>(null);
  protected readonly deletePending = computed(() => this.deleteProgress() !== null);

  protected readonly deleteTitle = computed(() => {
    const workflow = this.confirmDelete();
    if (!workflow) return '';
    const n = this.selectedRunIds().size;
    return `Delete ${n} run${n === 1 ? '' : 's'}?`;
  });
  protected readonly deleteProgressLabel = computed(() => {
    const progress = this.deleteProgress();
    return progress && progress.total > 0 ? `Deleting ${progress.done} of ${progress.total}…` : null;
  });

  protected WorkflowStateLabel(workflow: GithubWorkflow): string {
    return STATE_LABELS[workflow.state];
  }

  protected WorkflowStateClass(workflow: GithubWorkflow): string {
    return workflow.state === 'active' ? 'text-ok' : 'text-text-dim';
  }

  protected WorkflowRowClass(workflow: GithubWorkflow): string {
    const selected = this.selectedWorkflowId() === workflow.id;
    return `flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors ${
      selected ? 'bg-brand-dim' : 'hover:bg-panel-raised'
    }`;
  }

  protected SelectWorkflow(workflow: GithubWorkflow): void {
    this.selectedWorkflowId.set(workflow.id);
    this.runDeleteError.set(null);
    this.selectedRunIds.set(new Set());
    this.selectedRunForDetail.set(null);
  }

  protected HandleViewDetail(run: WorkflowRun): void {
    this.selectedRunForDetail.set(run);
  }

  protected HandleCloseDetail(): void {
    this.selectedRunForDetail.set(null);
  }

  protected async HandleDeleteRun(run: WorkflowRun): Promise<void> {
    const workflowId = this.selectedWorkflowId();
    if (workflowId === null) return;
    this.runDeleteError.set(null);
    this.deletingRunId.set(run.id);
    try {
      await this.workflowsFacade.deleteWorkflowRun.mutateAsync({ org: this.org(), repo: this.repo(), workflowId, runId: run.id });
    } catch (err) {
      this.runDeleteError.set(PermissionAwareMessage(err));
    } finally {
      this.deletingRunId.set(null);
    }
  }

  constructor() {
    // A poll can change the visible run list out from under a checked selection (e.g. a run drops
    // off the page, or GitHub returns it under a new id) — prune selectedRunIds down to ids still
    // present so "Delete N runs?" always matches what's actually still checked on screen.
    effect(() => {
      const currentIds = new Set(this.runs().map((r) => r.id));
      this.selectedRunIds.update((prev) => {
        const pruned = new Set([...prev].filter((id) => currentIds.has(id)));
        return pruned.size === prev.size ? prev : pruned;
      });
    });
  }

  protected HandleToggleRun(runId: number): void {
    this.selectedRunIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  protected HandleToggleSelectAll(): void {
    this.selectedRunIds.update((prev) => {
      const allIds = this.runs().map((r) => r.id);
      const allSelected = allIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(allIds);
    });
  }

  protected OpenConfirmDelete(workflow: GithubWorkflow): void {
    this.deleteError.set(null);
    this.confirmDelete.set(workflow);
  }

  protected async HandleConfirmDelete(): Promise<void> {
    const workflow = this.confirmDelete();
    if (!workflow) return;
    const runIds = Array.from(this.selectedRunIds());
    this.deleteError.set(null);
    this.deleteProgress.set({ done: 0, total: 0 });
    try {
      const result = await this.workflowsFacade.DeleteRuns(this.org(), this.repo(), workflow.id, runIds, (done, total) =>
        this.deleteProgress.set({ done, total }),
      );
      if (result.failedIds.length > 0) {
        // Narrow the selection down to just the failures so a retry only re-attempts what didn't
        // succeed — DeleteRuns works off a fixed id list, unlike the old delete-all which re-fetched.
        this.selectedRunIds.set(new Set(result.failedIds));
        this.deleteError.set(
          `Deleted ${result.succeededIds.length} of ${runIds.length} runs — ${result.failedIds.length} failed` +
            (result.permissionDenied ? ' (write access to this repository is required to delete every run).' : '.') +
            ' You can try again for the rest.',
        );
        return;
      }
      this.selectedRunIds.set(new Set());
      this.confirmDelete.set(null);
    } catch (err) {
      this.deleteError.set(PermissionAwareMessage(err));
    } finally {
      this.deleteProgress.set(null);
    }
  }

  protected HandleCancelDelete(): void {
    this.confirmDelete.set(null);
    this.deleteError.set(null);
  }
}
