import { Component, input, output } from '@angular/core';
import type { WorkflowRun } from '../../core/Types';

// GitHub's `status` covers the in-flight lifecycle; once status is 'completed', `conclusion`
// is what actually says how it ended — two different fields feeding one status pill, which is
// exactly the kind of small-but-real branching this pair of methods exists to isolate (see
// RunnersPanel.component.ts's RunnerState/RunnerDotClass for the precedent this mirrors). A full
// Strategy-pattern hierarchy would be unjustified for branching this shallow — see
// core/strategies/README.md.
const IN_FLIGHT_LABELS: Record<string, string> = {
  queued: 'Queued',
  in_progress: 'In progress',
  waiting: 'Waiting',
  requested: 'Requested',
  pending: 'Pending',
};

const CONCLUSION_LABELS: Record<string, string> = {
  success: 'Success',
  failure: 'Failure',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  timed_out: 'Timed out',
  action_required: 'Action required',
  stale: 'Stale',
  neutral: 'Neutral',
  startup_failure: 'Startup failure',
};

const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

/** Port-free, new component: the runs list for whichever workflow is selected in WorkflowsView. */
@Component({
  selector: 'app-workflow-runs-list',
  templateUrl: './WorkflowRunsList.component.html',
})
export class WorkflowRunsListComponent {
  readonly runs = input<WorkflowRun[]>([]);
  /** The run currently being deleted, if any — disables just that row's delete button. */
  readonly deletingRunId = input<number | null>(null);
  /** Ids of runs currently checked for bulk delete — owned by WorkflowsView, not this component. */
  readonly selectedRunIds = input<ReadonlySet<number>>(new Set());

  readonly deleteRun = output<WorkflowRun>();
  readonly toggleRun = output<number>();
  readonly toggleSelectAll = output<void>();

  protected AllSelected(): boolean {
    return this.runs().length > 0 && this.runs().every((r) => this.selectedRunIds().has(r.id));
  }

  protected SomeSelected(): boolean {
    return this.runs().some((r) => this.selectedRunIds().has(r.id)) && !this.AllSelected();
  }

  protected WorkflowRunStatusLabel(run: WorkflowRun): string {
    if (run.status === 'completed') return CONCLUSION_LABELS[run.conclusion ?? ''] ?? (run.conclusion ?? 'Completed');
    return IN_FLIGHT_LABELS[run.status ?? ''] ?? (run.status ?? 'Unknown');
  }

  protected WorkflowRunStatusClass(run: WorkflowRun): string {
    if (run.status === 'completed') {
      if (run.conclusion === 'success') return 'text-ok';
      if (run.conclusion && FAILURE_CONCLUSIONS.has(run.conclusion)) return 'text-danger';
      return 'text-text-dim';
    }
    return run.status === 'in_progress' ? 'text-variable' : 'text-text-dim';
  }

  protected WorkflowRunDotClass(run: WorkflowRun): string {
    if (run.status === 'completed') {
      if (run.conclusion === 'success') return 'bg-ok';
      if (run.conclusion && FAILURE_CONCLUSIONS.has(run.conclusion)) return 'bg-danger';
      return 'bg-text-dim';
    }
    return run.status === 'in_progress' ? 'bg-variable' : 'bg-text-dim';
  }

  protected FormatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  protected HandleDeleteClick(run: WorkflowRun): void {
    this.deleteRun.emit(run);
  }

  protected HandleToggleRun(runId: number): void {
    this.toggleRun.emit(runId);
  }

  protected HandleToggleSelectAll(): void {
    this.toggleSelectAll.emit();
  }
}
