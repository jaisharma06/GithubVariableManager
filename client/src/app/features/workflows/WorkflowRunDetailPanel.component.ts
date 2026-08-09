import { AfterViewInit, Component, ElementRef, HostListener, ViewChild, computed, effect, inject, input, output, signal } from '@angular/core';
import { WorkflowsFacade } from '../../core/facades/WorkflowsFacade';
import type { WorkflowRun, WorkflowRunJob, WorkflowRunJobStep } from '../../core/Types';
import { AvatarComponent } from '../../shared/components/Avatar.component';
import { ButtonComponent } from '../../shared/components/Button.component';
import * as WorkflowRunStatus from './WorkflowRunStatus';
import { FormatDuration, FormatTimestamp, NO_TIME } from './WorkflowRunTiming';
import { PermissionAwareMessage } from './WorkflowRunMessages';

/** A job that finished cleanly — nothing about it needs attention, so it opens collapsed. */
function SettledSuccessfully(job: WorkflowRunJob): boolean {
  return job.status === 'completed' && job.conclusion === 'success';
}

/**
 * The full detail of one workflow run: summary header, its jobs, and each job's ordered steps, in a
 * right-hand slide-over matching ItemEditorPanelComponent's panel shape (widened to max-w-2xl —
 * job/step rows need the room). Owns its own WorkflowRunDetailQuery and rerun mutation rather than
 * taking them as inputs, following CopyItemDialogComponent/RenameEnvironmentDialogComponent: a
 * dialog in this app receives the *subject* via inputs and injects the facade it needs itself,
 * emitting only `closed` back to its host.
 *
 * The `run` input (the row that was clicked) is what lets the header render immediately, before the
 * detail query resolves — the panel never opens empty.
 */
@Component({
  selector: 'app-workflow-run-detail-panel',
  imports: [AvatarComponent, ButtonComponent],
  templateUrl: './WorkflowRunDetailPanel.component.html',
})
export class WorkflowRunDetailPanelComponent implements AfterViewInit {
  readonly org = input.required<string>();
  readonly repo = input.required<string>();
  /** The run whose detail this panel shows — the list row the user clicked. */
  readonly run = input.required<WorkflowRun>();

  readonly closed = output<void>();

  private readonly workflowsFacade = inject(WorkflowsFacade);

  @ViewChild('closeButton') private readonly closeButton?: ElementRef<HTMLButtonElement>;

  protected readonly detailQuery = this.workflowsFacade.WorkflowRunDetailQuery(
    () => this.org(),
    () => this.repo(),
    () => this.run().id,
  );
  protected readonly detail = computed(() => this.detailQuery.data() ?? null);
  protected readonly jobs = computed(() => this.detail()?.jobs ?? []);

  /** Falls back to the clicked row's own status until the detail query resolves. */
  protected readonly statusInfo = computed<WorkflowRunStatus.WorkflowRunStatusInfo>(() => this.detail() ?? this.run());
  protected readonly inFlight = computed(() => this.statusInfo().status !== 'completed');

  protected readonly headline = computed(() => {
    const detail = this.detail();
    return detail?.commitMessage ?? detail?.displayTitle ?? this.run().commitMessage ?? detail?.name ?? 'Workflow run';
  });
  protected readonly shortSha = computed(() => this.detail()?.headSha?.slice(0, 7) ?? null);
  protected readonly runDuration = computed(() => {
    const detail = this.detail();
    if (!detail || detail.status !== 'completed') return null;
    return FormatDuration(detail.runStartedAt ?? detail.createdAt, detail.updatedAt);
  });

  protected readonly detailErrorMessage = computed(() => {
    const error = this.detailQuery.error();
    return error ? PermissionAwareMessage(error, 'reading this run’s jobs needs access to this repository') : null;
  });

  protected readonly rerunning = signal(false);
  protected readonly rerunError = signal<string | null>(null);
  protected readonly rerunRequested = signal(false);

  /** Ids of jobs whose step list is open. Purely local UI state — a poll never rewrites it. */
  private readonly expandedJobIds = signal<Set<number>>(new Set());
  /** Jobs whose open/closed default has already been decided, so a poll can't re-decide it. */
  private readonly decidedJobIds = new Set<number>();

  protected readonly titleId = `workflow-run-title-${Math.random().toString(36).slice(2, 9)}`;
  protected readonly noTime = NO_TIME;

  constructor() {
    // Decide each job's default open state exactly once, the first time it appears: anything that
    // didn't finish cleanly (failed, cancelled, still running) opens, because that's what someone
    // opening a run detail is looking for; a clean job stays collapsed to keep a 5-job × 15-step
    // run scannable. A lone job always opens — collapsing it would leave the panel looking empty.
    // Deciding once (rather than deriving from live status) is also what keeps the panel stable
    // while the query polls: a job completing mid-view must not collapse itself under the reader.
    effect(() => {
      const jobs = this.jobs();
      const unseen = jobs.filter((job) => !this.decidedJobIds.has(job.id));
      if (unseen.length === 0) return;

      for (const job of unseen) this.decidedJobIds.add(job.id);
      const toOpen = unseen.filter((job) => jobs.length === 1 || !SettledSuccessfully(job));
      if (toOpen.length === 0) return;

      this.expandedJobIds.update((prev) => new Set([...prev, ...toOpen.map((job) => job.id)]));
    });
  }

  ngAfterViewInit(): void {
    this.closeButton?.nativeElement.focus();
  }

  @HostListener('document:keydown', ['$event'])
  protected HandleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.closed.emit();
  }

  protected StatusLabel(info: WorkflowRunStatus.WorkflowRunStatusInfo): string {
    return WorkflowRunStatus.WorkflowRunStatusLabel(info);
  }

  protected StatusClass(info: WorkflowRunStatus.WorkflowRunStatusInfo): string {
    return WorkflowRunStatus.WorkflowRunStatusClass(info);
  }

  protected DotClass(info: WorkflowRunStatus.WorkflowRunStatusInfo): string {
    return WorkflowRunStatus.WorkflowRunDotClass(info);
  }

  /**
   * A cleanly-finished step keeps its label in the DOM for screen readers but hides it visually —
   * its green dot already says "fine", and 15 rows of "Success" is noise the eye has to filter to
   * find the one step that isn't.
   */
  protected StepLabelHidden(step: WorkflowRunJobStep): boolean {
    return step.status === 'completed' && step.conclusion === 'success';
  }

  protected Timestamp(iso: string | null): string {
    return FormatTimestamp(iso);
  }

  protected JobDuration(job: WorkflowRunJob): string {
    return FormatDuration(job.startedAt, job.completedAt) ?? NO_TIME;
  }

  protected StepDuration(step: WorkflowRunJobStep): string {
    return FormatDuration(step.startedAt, step.completedAt) ?? NO_TIME;
  }

  protected IsExpanded(jobId: number): boolean {
    return this.expandedJobIds().has(jobId);
  }

  protected StepsId(jobId: number): string {
    return `workflow-job-steps-${jobId}`;
  }

  protected ToggleJob(jobId: number): void {
    this.expandedJobIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  protected async HandleRerun(): Promise<void> {
    this.rerunError.set(null);
    this.rerunRequested.set(false);
    this.rerunning.set(true);
    try {
      await this.workflowsFacade.rerunWorkflowRun.mutateAsync({ org: this.org(), repo: this.repo(), runId: this.run().id });
      this.rerunRequested.set(true);
    } catch (err) {
      this.rerunError.set(PermissionAwareMessage(err, 'rerunning a workflow requires write access to this repository'));
    } finally {
      this.rerunning.set(false);
    }
  }
}
