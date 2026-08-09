import { GitHubApiError } from '../../core/gateways/GitHubApiError';

/**
 * One phrasing of "GitHub said no" for every workflow flow that can hit it — run delete, run
 * rerun, and the detail query. Lives in its own module rather than on WorkflowsViewComponent (its
 * original home) so WorkflowRunDetailPanelComponent can use it without a circular import back into
 * the view that renders the panel.
 *
 * `lockedHint` names the action in the caller's own words: a 403 on deleting runs and a 403 on
 * rerunning one need the same shape of message but not the same sentence, and a 403 on merely
 * *reading* a run isn't about write access at all.
 */
export function PermissionAwareMessage(
  err: unknown,
  lockedHint = 'deleting workflow runs requires write access to this repository',
): string {
  if (err instanceof GitHubApiError && err.locked) {
    return `GitHub rejected this — ${lockedHint}.`;
  }
  return err instanceof Error ? err.message : 'GitHub rejected this request.';
}
