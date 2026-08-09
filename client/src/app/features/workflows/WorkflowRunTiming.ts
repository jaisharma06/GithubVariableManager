// GitHub hands back raw ISO timestamps on runs, jobs, and steps, and this feature needs two
// different readings of them: an absolute "when did this happen" for the run header and runs list,
// and an elapsed "how long did this take" for every job and step row. Plain functions in their own
// module for the same reason as WorkflowRunStatus.ts — shared by WorkflowRunsListComponent and
// WorkflowRunDetailPanelComponent, and far too small to justify a service.

/** Placeholder shown wherever GitHub hasn't reported a timestamp/duration (yet). */
export const NO_TIME = '—';

/**
 * An absolute timestamp, deliberately short: the runs list renders these in a 9rem column, and a
 * full `toLocaleString()` overflows it on most locales.
 */
export function FormatTimestamp(iso: string | null): string {
  if (!iso) return NO_TIME;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NO_TIME;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Elapsed time between two ISO timestamps, or null when it can't be known yet — anything still in
 * flight has no `completedAt`, and the panel renders NO_TIME rather than a live-counting elapsed
 * value on purpose: the detail query re-polls every 5s while a run is in flight, and a ticking
 * number would redraw (and re-measure) every row on every poll.
 */
export function FormatDuration(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;

  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}
