using System.Net;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;
using Octokit;
using Octokit.Internal;

namespace GithubVariablesManager.Api.Tests.Services;

public class WorkflowsServiceTests
{
    private static (WorkflowsService Service, FakeHttpMessageHandler Handler) CreateService()
    {
        var handler = new FakeHttpMessageHandler();
        var client = new GitHubClient(new Connection(
            new ProductHeaderValue("GithubVariablesManagerTests"),
            new Uri("https://api.github.com"),
            new InMemoryCredentialStore(new Credentials("test-token")),
            new HttpClientAdapter(() => handler),
            new SimpleJsonSerializer()));
        return (new WorkflowsService(new StubGitHubClientFactory(client)), handler);
    }

    private static string WorkflowsPageJson(int totalCount, params long[] ids)
    {
        var workflows = string.Join(',', ids.Select(id =>
            $$"""{"id":{{id}},"name":"CI","path":".github/workflows/ci.yml","state":"active"}"""));
        return $$"""{"total_count":{{totalCount}},"workflows":[{{workflows}}]}""";
    }

    private const string RunsJson = """
        {"total_count":1,"workflow_runs":[{"id":501,"name":"CI","status":"completed","conclusion":"success","run_number":7,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:05:00Z","html_url":"https://github.com/acme-corp/widgets/actions/runs/501"}]}
        """;

    [Fact]
    public async Task ListWorkflowsAsync_MapsOctokitWorkflows_ViaStringValueState()
    {
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.OK, WorkflowsPageJson(1, 1));

        var workflows = await service.ListWorkflowsAsync("octo-org", "widgets");

        var workflow = Assert.Single(workflows);
        Assert.Equal(1, workflow.Id);
        Assert.Equal("CI", workflow.Name);
        Assert.Equal(".github/workflows/ci.yml", workflow.Path);
        Assert.Equal("active", workflow.State);
    }

    [Fact]
    public async Task ListWorkflowsAsync_FullyPaginates_WhenMoreItemsThanOnePage()
    {
        // Opposite assertion from RunnersServiceTests' single-page cap test: this preserves the
        // pre-migration Angular Gateway's full-pagination behavior, so more than one HTTP call must
        // happen when total_count exceeds what one page reports.
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.OK, WorkflowsPageJson(2, 1));
        handler.Enqueue(HttpStatusCode.OK, WorkflowsPageJson(2, 2));

        var workflows = await service.ListWorkflowsAsync("octo-org", "widgets");

        Assert.Equal(2, workflows.Count);
        Assert.True(handler.RequestedPaths.Count > 1);
    }

    [Fact]
    public async Task ListWorkflowRunsAsync_RespectsPerPage_WithExactlyOneCall()
    {
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.OK, RunsJson);

        var runs = await service.ListWorkflowRunsAsync("octo-org", "widgets", 1, 30);

        var run = Assert.Single(runs);
        Assert.Equal(501, run.Id);
        Assert.Equal("completed", run.Status);
        Assert.Equal("success", run.Conclusion);
        Assert.Equal(7, run.RunNumber);
        Assert.Equal("https://github.com/acme-corp/widgets/actions/runs/501", run.HtmlUrl);

        var requestedPath = Assert.Single(handler.RequestedPaths);
        Assert.Contains("per_page=30", requestedPath);
    }

    [Fact]
    public async Task DeleteWorkflowRunAsync_IssuesDelete_ToTheRightPath()
    {
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.NoContent, "{}");

        await service.DeleteWorkflowRunAsync("octo-org", "widgets", 501);

        Assert.Equal(HttpMethod.Delete, Assert.Single(handler.RequestedMethods));
        var requestedPath = Assert.Single(handler.RequestedPaths);
        Assert.Contains("/repos/octo-org/widgets/actions/runs/501", requestedPath);
    }

    /// <summary>Hands WorkflowsService an already-built Octokit client wired to a fake transport, bypassing the real bearer-token/HttpContext plumbing GitHubClientFactory normally requires.</summary>
    private sealed class StubGitHubClientFactory(IGitHubClient client) : GitHubClientFactory(new NullBearerTokenAccessor())
    {
        public override IGitHubClient CreateForCurrentUser() => client;
    }
}
