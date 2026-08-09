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

    private const string RunDetailJson = """
        {"id":501,"name":"CI","status":"completed","conclusion":"success","run_number":7,
        "run_attempt":1,"event":"push","display_title":"Merge pull request #42 from acme/fix",
        "head_branch":"main","head_sha":"abc123",
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:05:00Z",
        "run_started_at":"2026-01-01T00:01:00Z",
        "html_url":"https://github.com/acme-corp/widgets/actions/runs/501",
        "actor":{"login":"octocat","avatar_url":"https://avatars.example/octocat.png"},
        "head_commit":{"message":"Fix bug in parser\n\nSome longer body text here."}}
        """;

    private const string RunDetailJsonNoHeadCommit = """
        {"id":501,"name":"CI","status":"completed","conclusion":"success","run_number":7,
        "run_attempt":1,"event":"push","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:05:00Z",
        "html_url":"https://github.com/acme-corp/widgets/actions/runs/501"}
        """;

    private static string JobsPageJson(int totalCount, params long[] ids)
    {
        var jobs = string.Join(',', ids.Select(id =>
            $$"""
            {"id":{{id}},"name":"build","status":"completed","conclusion":"success",
            "started_at":"2026-01-01T00:01:00Z","completed_at":"2026-01-01T00:04:00Z",
            "steps":[{"name":"Checkout","number":1,"status":"completed","conclusion":"success","started_at":"2026-01-01T00:01:00Z","completed_at":"2026-01-01T00:02:00Z"}]}
            """));
        return $$"""{"total_count":{{totalCount}},"jobs":[{{jobs}}]}""";
    }

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

    [Fact]
    public async Task ListWorkflowRunsAsync_CommitMessage_ReadsHeadCommitMessagesFirstLine()
    {
        var runJsonWithCommit = """
            {"total_count":1,"workflow_runs":[{"id":501,"name":"CI","status":"completed","conclusion":"success","run_number":7,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:05:00Z","html_url":"https://github.com/acme-corp/widgets/actions/runs/501","head_commit":{"message":"Fix bug in parser\n\nSome longer body text here."}}]}
            """;
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.OK, runJsonWithCommit);

        var runs = await service.ListWorkflowRunsAsync("octo-org", "widgets", 1, 30);

        Assert.Equal("Fix bug in parser", Assert.Single(runs).CommitMessage);
    }

    [Fact]
    public async Task ListWorkflowRunsAsync_CommitMessage_IsNull_WhenHeadCommitAbsent()
    {
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.OK, RunsJson);

        var runs = await service.ListWorkflowRunsAsync("octo-org", "widgets", 1, 30);

        Assert.Null(Assert.Single(runs).CommitMessage);
    }

    [Fact]
    public async Task GetWorkflowRunDetailAsync_MapsRunAndJobsAndSteps()
    {
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.OK, RunDetailJson);
        handler.Enqueue(HttpStatusCode.OK, JobsPageJson(1, 9001));

        var detail = await service.GetWorkflowRunDetailAsync("octo-org", "widgets", 501);

        Assert.Equal(501, detail.Id);
        Assert.Equal("CI", detail.Name);
        Assert.Equal("Merge pull request #42 from acme/fix", detail.DisplayTitle);
        Assert.Equal("Fix bug in parser", detail.CommitMessage);
        Assert.Equal("completed", detail.Status);
        Assert.Equal("success", detail.Conclusion);
        Assert.Equal("push", detail.Event);
        Assert.Equal(7, detail.RunNumber);
        Assert.Equal(1, detail.RunAttempt);
        Assert.Equal("main", detail.HeadBranch);
        Assert.Equal("abc123", detail.HeadSha);
        Assert.Equal("octocat", detail.ActorLogin);
        Assert.Equal("https://avatars.example/octocat.png", detail.ActorAvatarUrl);
        Assert.Equal("https://github.com/acme-corp/widgets/actions/runs/501", detail.HtmlUrl);

        var job = Assert.Single(detail.Jobs);
        Assert.Equal(9001, job.Id);
        Assert.Equal("build", job.Name);
        Assert.Equal("completed", job.Status);
        Assert.Equal("success", job.Conclusion);
        var step = Assert.Single(job.Steps);
        Assert.Equal("Checkout", step.Name);
        Assert.Equal(1, step.Number);
        Assert.Equal("completed", step.Status);
        Assert.Equal("success", step.Conclusion);
    }

    [Fact]
    public async Task GetWorkflowRunDetailAsync_CommitMessage_IsNull_WhenHeadCommitAbsent()
    {
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.OK, RunDetailJsonNoHeadCommit);
        handler.Enqueue(HttpStatusCode.OK, JobsPageJson(0));

        var detail = await service.GetWorkflowRunDetailAsync("octo-org", "widgets", 501);

        Assert.Null(detail.CommitMessage);
    }

    [Fact]
    public async Task GetWorkflowRunDetailAsync_FullyPaginatesJobs_WhenMoreItemsThanOnePage()
    {
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.OK, RunDetailJson);
        handler.Enqueue(HttpStatusCode.OK, JobsPageJson(2, 9001));
        handler.Enqueue(HttpStatusCode.OK, JobsPageJson(2, 9002));

        var detail = await service.GetWorkflowRunDetailAsync("octo-org", "widgets", 501);

        Assert.Equal(2, detail.Jobs.Count);
        // First request is the run Get, the remaining two are the paginated jobs List calls.
        Assert.Equal(3, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task RerunWorkflowRunAsync_IssuesPost_ToTheRightPath()
    {
        var (service, handler) = CreateService();
        handler.Enqueue(HttpStatusCode.Created, "{}");

        await service.RerunWorkflowRunAsync("octo-org", "widgets", 501);

        Assert.Equal(HttpMethod.Post, Assert.Single(handler.RequestedMethods));
        var requestedPath = Assert.Single(handler.RequestedPaths);
        Assert.Contains("/repos/octo-org/widgets/actions/runs/501/rerun", requestedPath);
    }

    /// <summary>Hands WorkflowsService an already-built Octokit client wired to a fake transport, bypassing the real bearer-token/HttpContext plumbing GitHubClientFactory normally requires.</summary>
    private sealed class StubGitHubClientFactory(IGitHubClient client) : GitHubClientFactory(new NullBearerTokenAccessor())
    {
        public override IGitHubClient CreateForCurrentUser() => client;
    }
}
