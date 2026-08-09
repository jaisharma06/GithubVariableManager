using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Looks up the viewer (the GitHub user the current request's bearer token belongs to). No
/// try/catch here — a bad/expired token surfaces as <see cref="Octokit.ApiException"/>, which
/// propagates to the global <see cref="Auth.PermissionErrorExceptionHandler"/> uncaught.
/// </summary>
public sealed class ViewerService(GitHubClientFactory gitHubClientFactory)
{
    public Task<ViewerResponse> GetViewerAsync() => MapViewerAsync(gitHubClientFactory.CreateForCurrentUser());

    // Split out from GetViewerAsync so a test can exercise the Octokit-call-and-map step against
    // a real Octokit.IGitHubClient wired to a fake HTTP transport, without needing a bearer
    // token/HttpContext to flow through GitHubClientFactory (which always targets the real
    // api.github.com and has no seam for that).
    internal static async Task<ViewerResponse> MapViewerAsync(Octokit.IGitHubClient client)
    {
        var user = await client.User.Current();
        return new ViewerResponse(user.Login, user.AvatarUrl);
    }
}
