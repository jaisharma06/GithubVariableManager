using System.Net;
using GithubVariablesManager.Api.GitHub;
using Octokit;
using Octokit.Internal;

namespace GithubVariablesManager.Api.Tests.GitHub;

/// <summary>
/// Throwaway spike, run once before building out the rest of RawActionsModels.cs/
/// ActionsRestClient.cs: empirically confirms whether Octokit's SimpleJsonSerializer auto-maps
/// plain PascalCase properties on a mutable class to GitHub's snake_case JSON (the same way it
/// does for Octokit's own typed models, e.g. Repository.CreatedAt <-> created_at), or whether
/// explicit [Parameter(Key = "...")] attributes are needed. Kept as a permanent regression test
/// (not deleted) since it documents the empirical finding for future readers.
/// </summary>
public class RawActionsModelsSpikeTests
{
    [Fact]
    public async Task ConnectionGet_DeserializesRealGitHubSnakeCaseJson_IntoRawVariableListResponse()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """
            {
              "total_count": 1,
              "variables": [
                {
                  "name": "USERNAME",
                  "value": "octocat",
                  "created_at": "2019-08-10T14:59:22Z",
                  "updated_at": "2020-01-10T14:59:22Z"
                }
              ]
            }
            """);
        var connection = new Connection(
            new ProductHeaderValue("GithubVariablesManagerTests"),
            new Uri("https://api.github.com"),
            new InMemoryCredentialStore(new Credentials("test-token")),
            new HttpClientAdapter(() => handler),
            new SimpleJsonSerializer());

        var response = await connection.Get<RawVariableListResponse>(
            new Uri("orgs/octo-org/actions/variables", UriKind.Relative),
            new Dictionary<string, string>());

        Assert.Equal(1, response.Body.TotalCount);
        var variable = Assert.Single(response.Body.Variables);
        Assert.Equal("USERNAME", variable.Name);
        Assert.Equal("octocat", variable.Value);
        Assert.Equal(new DateTimeOffset(2019, 8, 10, 14, 59, 22, TimeSpan.Zero), variable.CreatedAt);
        Assert.Equal(new DateTimeOffset(2020, 1, 10, 14, 59, 22, TimeSpan.Zero), variable.UpdatedAt);
    }
}
