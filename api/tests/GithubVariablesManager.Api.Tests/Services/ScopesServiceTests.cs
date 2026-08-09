using System.Net;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;
using Octokit;
using Octokit.Internal;

namespace GithubVariablesManager.Api.Tests.Services;

public class ScopesServiceTests
{
    private static ScopesService CreateService(FakeHttpMessageHandler handler)
    {
        var client = new GitHubClient(new Connection(
            new ProductHeaderValue("GithubVariablesManagerTests"),
            new Uri("https://api.github.com"),
            new InMemoryCredentialStore(new Credentials("test-token")),
            new HttpClientAdapter(() => handler),
            new SimpleJsonSerializer()));
        return new ScopesService(new StubGitHubClientFactory(client));
    }

    [Fact]
    public async Task ListMyOrgsAsync_MapsOctokitOrgs_ToOrgResponse()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """
            [{"login":"octo-org","avatar_url":"https://avatars.githubusercontent.com/o/1"}]
            """);
        var service = CreateService(handler);

        var orgs = await service.ListMyOrgsAsync();

        var org = Assert.Single(orgs);
        Assert.Equal("octo-org", org.Login);
        Assert.Equal("https://avatars.githubusercontent.com/o/1", org.AvatarUrl);
    }

    [Fact]
    public async Task ListMyReposAsync_MapsOctokitRepos_AndMakesExactlyOneHttpCall()
    {
        // The Link header advertises a next page, proving PageCount = 1 is what stops pagination
        // here — not merely a fake handler with nothing left to serve.
        var handler = new FakeHttpMessageHandler().Enqueue(
            HttpStatusCode.OK,
            """[{"id":1,"name":"repo-one","full_name":"octocat/repo-one","owner":{"login":"octocat"},"private":false}]""",
            "<https://api.github.com/user/repos?page=2>; rel=\"next\"");
        var service = CreateService(handler);

        var repos = await service.ListMyReposAsync();

        var repo = Assert.Single(repos);
        Assert.Equal(1, repo.Id);
        Assert.Equal("repo-one", repo.Name);
        Assert.Equal("octocat/repo-one", repo.FullName);
        Assert.Equal("octocat", repo.Owner);
        Assert.False(repo.Private);
        Assert.Single(handler.RequestedPaths);
    }

    [Fact]
    public async Task ListOrgReposAsync_FollowsLinkHeaderPagination_AndConcatenatesResults()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(
                HttpStatusCode.OK,
                """[{"id":1,"name":"repo-one","full_name":"octo-org/repo-one","owner":{"login":"octo-org"},"private":false}]""",
                "<https://api.github.com/organizations/1/repos?page=2>; rel=\"next\"")
            .Enqueue(
                HttpStatusCode.OK,
                """[{"id":2,"name":"repo-two","full_name":"octo-org/repo-two","owner":{"login":"octo-org"},"private":true}]""");
        var service = CreateService(handler);

        var repos = await service.ListOrgReposAsync("octo-org");

        Assert.Equal(2, repos.Count);
        Assert.Equal([1L, 2L], repos.Select(r => r.Id));
        Assert.Equal(2, handler.RequestedPaths.Count);
    }

    [Theory]
    [InlineData("Organization", "octo-org")]
    [InlineData("User", "octocat")]
    public async Task GetAccountTypeAsync_MapsOctokitAccountType(string type, string login)
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, $$"""
            {"login":"{{login}}","type":"{{type}}"}
            """);
        var service = CreateService(handler);

        var result = await service.GetAccountTypeAsync(login);

        Assert.Equal(type, result.Type);
    }

    /// <summary>Hands ScopesService an already-built Octokit client wired to a fake transport, bypassing the real bearer-token/HttpContext plumbing GitHubClientFactory normally requires.</summary>
    private sealed class StubGitHubClientFactory(IGitHubClient client) : GitHubClientFactory(new NullBearerTokenAccessor())
    {
        public override IGitHubClient CreateForCurrentUser() => client;
    }
}
