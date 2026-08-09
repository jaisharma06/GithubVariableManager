import { Component, input, output } from '@angular/core';
import type { WorkflowRun } from '../../core/Types';
import * as WorkflowRunStatus from './WorkflowRunStatus';
import { FormatTimestamp } from './WorkflowRunTiming';

/**
 * Port-free, new component: the runs list for whichever workflow is selected in WorkflowsView.
 * Purely `@Input()`/`@Output()`-driven — no facade, no query (see `features/workflows/README.md`).
 * Status/conclusion → label/color mapping now lives in `WorkflowRunStatus.ts` so the (upcoming)
 * run-detail panel can reuse it for its per-job/per-step pills without duplicating the vocabulary.
 */
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
  /** Emitted when a row is clicked (outside the checkbox/delete button/external link) to open its detail. */
  readonly viewDetail = output<WorkflowRun>();

  protected AllSelected(): boolean {
    return this.runs().length > 0 && this.runs().every((r) => this.selectedRunIds().has(r.id));
  }

  protected SomeSelected(): boolean {
    return this.runs().some((r) => this.selectedRunIds().has(r.id)) && !this.AllSelected();
  }

  protected WorkflowRunStatusLabel(run: WorkflowRun): string {
    return WorkflowRunStatus.WorkflowRunStatusLabel(run);
  }

  protected WorkflowRunStatusClass(run: WorkflowRun): string {
    return WorkflowRunStatus.WorkflowRunStatusClass(run);
  }

  protected WorkflowRunDotClass(run: WorkflowRun): string {
    return WorkflowRunStatus.WorkflowRunDotClass(run);
  }

  /** Shares WorkflowRunTiming's formatting with the detail panel — one date vocabulary per feature,
   * and short enough not to overflow this list's 9rem date columns. */
  protected FormatDate(iso: string): string {
    return FormatTimestamp(iso);
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

  protected HandleRowClick(run: WorkflowRun): void {
    this.viewDetail.emit(run);
  }
}
