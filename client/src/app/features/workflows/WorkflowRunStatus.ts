// GitHub's `status` covers the in-flight lifecycle; once status is 'completed', `conclusion` is
// what actually says how it ended — two different fields feeding one status pill. Extracted out of
// WorkflowRunsListComponent (its original, only call site) so the upcoming run-detail panel's run
// header, per-job pills, and per-step pills can all reuse the same status/conclusion-to-label/color
// vocabulary rather than re-deriving it a second/third/fourth time. Plain functions over a class or
// a Strategy-pattern hierarchy — this branching is shallow, same reasoning as
// RunnersPanel.component.ts's RunnerState/RunnerDotClass pair (see core/strategies/README.md for
// why a formal pattern is declined here).

/** The subset of a run/job/step's fields this vocabulary actually depends on. */
export interface WorkflowRunStatusInfo {
  status: string | null;
  conclusion: string | null;
}

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

export function WorkflowRunStatusLabel(info: WorkflowRunStatusInfo): string {
  if (info.status === 'completed') return CONCLUSION_LABELS[info.conclusion ?? ''] ?? (info.conclusion ?? 'Completed');
  return IN_FLIGHT_LABELS[info.status ?? ''] ?? (info.status ?? 'Unknown');
}

export function WorkflowRunStatusClass(info: WorkflowRunStatusInfo): string {
  if (info.status === 'completed') {
    if (info.conclusion === 'success') return 'text-ok';
    if (info.conclusion && FAILURE_CONCLUSIONS.has(info.conclusion)) return 'text-danger';
    return 'text-text-dim';
  }
  return info.status === 'in_progress' ? 'text-variable' : 'text-text-dim';
}

export function WorkflowRunDotClass(info: WorkflowRunStatusInfo): string {
  if (info.status === 'completed') {
    if (info.conclusion === 'success') return 'bg-ok';
    if (info.conclusion && FAILURE_CONCLUSIONS.has(info.conclusion)) return 'bg-danger';
    return 'bg-text-dim';
  }
  return info.status === 'in_progress' ? 'bg-variable' : 'bg-text-dim';
}
