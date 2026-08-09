import { GitHubApiError } from './GitHubApiError';

/**
 * Covers the `locked` param added in Phase 4 (the Runners vertical) — see
 * `BackendRunnersGateway.service.ts`'s doc comment for why a Backend gateway needs to pass it
 * explicitly. No prior gateway file in this folder has its own spec (GitHubApiError used to be a
 * plain status pass-through with nothing worth unit-testing); it gained real default-computation
 * logic here, so a dedicated spec — mirroring this codebase's file-per-class spec convention used
 * throughout `features/*` — is more appropriate than folding it into an unrelated component spec.
 */
describe('GitHubApiError', () => {
  it('defaults locked to true for a 403, when no third argument is passed', () => {
    const err = new GitHubApiError('Forbidden', 403);
    expect(err.locked).toBe(true);
  });

  it('defaults locked to true for a 404, when no third argument is passed', () => {
    const err = new GitHubApiError('Not Found', 404);
    expect(err.locked).toBe(true);
  });

  it('defaults locked to false for any other status, when no third argument is passed', () => {
    const err = new GitHubApiError('Server Error', 500);
    expect(err.locked).toBe(false);
  });

  it('honors an explicit locked value over the status-derived default', () => {
    expect(new GitHubApiError('Forbidden', 403, false).locked).toBe(false);
    expect(new GitHubApiError('Server Error', 500, true).locked).toBe(true);
  });

  it('still exposes .status unchanged, so existing status-based checks (e.g. WorkflowsFacade/WorkflowsView.component.ts) keep working', () => {
    const err = new GitHubApiError('Forbidden', 403);
    expect(err.status).toBe(403);
  });
});
