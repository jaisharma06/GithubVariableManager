namespace GithubVariablesManager.Api.GitHub;

/// <summary>
/// Builds an Octokit <see cref="Octokit.IGitHubClient"/> credentialed with a given bearer token.
/// Extracted out of <see cref="GitHubClientFactory"/> so both the per-request, HttpContext-bound
/// factory and <see cref="Services.WorkflowRunCleanupService"/> (a <c>Singleton</c> that cannot
/// depend on anything HttpContext-bound — see that class's doc comment) can build an Octokit client
/// from a plain token string without duplicating the construction.
/// </summary>
public static class OctokitClientBuilder
{
    public static Octokit.IGitHubClient BuildFor(string token) =>
        new Octokit.GitHubClient(new Octokit.ProductHeaderValue("GithubVariablesManager"))
        {
            Credentials = new Octokit.Credentials(token)
        };
}
