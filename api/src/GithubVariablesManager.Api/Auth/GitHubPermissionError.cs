namespace GithubVariablesManager.Api.Auth;

/// <summary>
/// Structured shape for a GitHub 403/404 "no access to this scope" response — the one place this
/// classification happens, per docs/Architecture.md's "Centralized permission-error
/// classification". Every later-phase endpoint returns this shape uniformly instead of Angular
/// interpreting raw HTTP status codes itself (as it does today, independently, in four places:
/// LedgerSupport.RunLedgerJobs, GithubEnvironmentsGateway, RunnersPanel.component.ts,
/// WorkflowsFacade).
/// </summary>
public sealed record GitHubPermissionError(bool Locked, int Status, string Message);
