using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using Octokit;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Environments vertical — reads (<see cref="ListEnvironmentsAsync"/>) plus, as of Phase 3c,
/// writes (<see cref="CreateEnvironmentAsync"/>/<see cref="DeleteEnvironmentAsync"/>). The
/// rename orchestration built on top of these lives in <see cref="EnvironmentRenameService"/>.
/// </summary>
public sealed class EnvironmentsService(ActionsRestClient actionsRestClient)
{
    /// <summary>
    /// Direct port of <c>GithubEnvironmentsGateway.service.ts</c>'s <c>ListEnvironments</c>:
    /// repos without any configured environments (or on plans without env support) 404 here, and
    /// that's a "no environments" business fact, not a permission failure — caught locally so it
    /// never reaches <see cref="Auth.PermissionErrorExceptionHandler"/>, which would otherwise
    /// wrongly present "no environments" as a locked section. This is a local-catch-for-a-
    /// non-permission-reason, consistent with (not a deviation from) the "no local try/catch for
    /// GitHub-thrown permission errors" rule — mirroring the <see cref="OAuthRelayException"/>
    /// precedent of catching only a specific, well-understood non-permission case.
    /// </summary>
    public async Task<IReadOnlyList<EnvironmentResponse>> ListEnvironmentsAsync(string org, string repo)
    {
        try
        {
            var raw = await actionsRestClient.ListEnvironmentsAsync(org, repo);
            return raw.Select(e => new EnvironmentResponse(e.Name, e.Id)).ToList();
        }
        catch (NotFoundException)
        {
            return [];
        }
    }

    public Task CreateEnvironmentAsync(string org, string repo, string name) =>
        actionsRestClient.CreateEnvironmentAsync(org, repo, name);

    public Task DeleteEnvironmentAsync(string org, string repo, string name) =>
        actionsRestClient.DeleteEnvironmentAsync(org, repo, name);
}
