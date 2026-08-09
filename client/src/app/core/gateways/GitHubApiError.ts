// Direct port of web/src/api/client.ts's GitHubApiError.
export class GitHubApiError extends Error {
  public readonly locked: boolean;

  constructor(
    message: string,
    public readonly status: number,
    // Optional: defaults to the status-derived check every pre-Backend-Gateway call site already
    // used inline (`status === 403 || status === 404`), so every existing two-arg call site
    // (WorkflowsFacade/WorkflowsView.component.ts's still-untouched checks, this class's own older
    // specs) keeps behaving exactly as before. A Backend gateway that reads a `locked` flag
    // straight off its backend's response body passes it explicitly instead of letting this
    // recompute it from `status` — see BackendRunnersGateway.service.ts.
    locked?: boolean,
  ) {
    super(message);
    this.name = 'GitHubApiError';
    this.locked = locked ?? (status === 403 || status === 404);
  }
}
