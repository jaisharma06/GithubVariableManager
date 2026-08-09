namespace GithubVariablesManager.Api.GitHub;

/// <summary>
/// Builds an Octokit <see cref="Octokit.IGitHubClient"/> credentialed with the current request's
/// bearer token — the first real use of <see cref="Auth.IBearerTokenAccessor"/>, and the shared
/// entry point every later migration vertical's GitHub-calling code goes through.
/// Not <c>sealed</c>/<c>CreateForCurrentUser</c> is <c>virtual</c> purely so integration tests
/// (<c>AuthEndpointsTests</c>) can substitute a fake Octokit client wired to a fake HTTP
/// transport via <c>WithWebHostBuilder</c> — this class always targets the real
/// <c>api.github.com</c> otherwise, with no other seam to avoid that in a test.
/// </summary>
public class GitHubClientFactory(Auth.IBearerTokenAccessor tokenAccessor)
{
    public virtual Octokit.IGitHubClient CreateForCurrentUser()
    {
        var token = tokenAccessor.GetToken()
            ?? throw new InvalidOperationException("No bearer token available for the current request.");
        return OctokitClientBuilder.BuildFor(token);
    }
}
