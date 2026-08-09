namespace GithubVariablesManager.Api.Auth;

/// <summary>
/// Extracts the caller's GitHub token from the incoming request's Authorization header.
/// Stateless by design: nothing here is ever persisted — see docs/Architecture.md's
/// "Token pass-through model". Later phases inject this into GitHub/*Client wrappers to attach
/// the same per-request token to outbound Octokit calls.
/// </summary>
public interface IBearerTokenAccessor
{
    string? GetToken();
}
