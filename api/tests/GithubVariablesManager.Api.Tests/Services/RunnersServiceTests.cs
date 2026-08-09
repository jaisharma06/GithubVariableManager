using System.Net;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;
using Octokit;
using Octokit.Internal;

namespace GithubVariablesManager.Api.Tests.Services;

public class RunnersServiceTests
{
    private static (RunnersService Service, FakeHttpMessageHandler Handler) CreateService()
    {
        var handler = new FakeHttpMessageHandler();
        var client = new GitHubClient(new Connection(
            new ProductHeaderValue("GithubVariablesManagerTests"),
            new Uri("https://api.github.com"),
            new InMemoryCredentialStore(new Credentials("test-token")),
            new HttpClientAdapter(() => handler),
            new SimpleJsonSerializer()));
        return (new RunnersService(new StubGitHubClientFactory(client)), handler);
    }

    private const string RunnerJson = """
        {"total_count":1,"runners":[{"id":1,"name":"runner-one","os":"linux","status":"online","busy":false,"labels":[{"id":10,"name":"self-hosted","type":"read-only"}]}]}
        """;

    [Fact]
    public async Task ListRunnersAsync_NoRepo_MapsOctokitRunners_AndCallsOrgEndpoint()
    {
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.OK, RunnerJson);

        var runners = await service.ListRunnersAsync("octo-org", null);

        var runner = Assert.Single(runners);
        Assert.Equal(1, runner.Id);
        Assert.Equal("runner-one", runner.Name);
        Assert.Equal("linux", runner.Os);
        Assert.Equal("online", runner.Status);
        Assert.False(runner.Busy);
        var label = Assert.Single(runner.Labels);
        Assert.Equal(10, label.Id);
        Assert.Equal("self-hosted", label.Name);
        Assert.Equal("read-only", label.Type);

        var requestedPath = Assert.Single(handler.RequestedPaths);
        Assert.Contains("/orgs/octo-org/actions/runners", requestedPath);
    }

    [Fact]
    public async Task ListRunnersAsync_WithRepo_MapsOctokitRunners_AndCallsRepoEndpoint()
    {
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.OK, RunnerJson);

        var runners = await service.ListRunnersAsync("octo-org", "widgets");

        Assert.Single(runners);
        var requestedPath = Assert.Single(handler.RequestedPaths);
        Assert.Contains("/repos/octo-org/widgets/actions/runners", requestedPath);
    }

    [Fact]
    public async Task ListRunnersAsync_MakesExactlyOneHttpCall_EvenWhenMorePagesAreAdvertised()
    {
        // The Link header advertises a next page, proving PageCount = 1 is what stops pagination
        // here — not merely a fake handler with nothing left to serve.
        var (service, handler) = CreateService();
        handler.Enqueue(
            HttpStatusCode.OK,
            RunnerJson,
            "<https://api.github.com/orgs/octo-org/actions/runners?page=2>; rel=\"next\"");

        await service.ListRunnersAsync("octo-org", null);

        Assert.Single(handler.RequestedPaths);
    }

    /// <summary>Hands RunnersService an already-built Octokit client wired to a fake transport, bypassing the real bearer-token/HttpContext plumbing GitHubClientFactory normally requires.</summary>
    private sealed class StubGitHubClientFactory(IGitHubClient client) : GitHubClientFactory(new NullBearerTokenAccessor())
    {
        public override IGitHubClient CreateForCurrentUser() => client;
    }
}
