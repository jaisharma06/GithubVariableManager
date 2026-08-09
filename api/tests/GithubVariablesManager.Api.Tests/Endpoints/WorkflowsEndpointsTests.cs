using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Octokit;
using Octokit.Internal;

namespace GithubVariablesManager.Api.Tests.Endpoints;

/// <summary>
/// Endpoint-level coverage for <c>WorkflowsEndpoints.cs</c>'s five routes, mirroring
/// <c>RunnersEndpointsTests.cs</c>/<c>ScopesEndpointsTests.cs</c>'s
/// <see cref="WebApplicationFactory{TEntryPoint}"/> + fake-GitHub-client DI-override style. The
/// cleanup start+poll pair additionally overrides <see cref="WorkflowRunCleanupService"/>'s
/// Singleton registration with one built against the same <see cref="FakeHttpMessageHandler"/> —
/// same test seam <c>Services/WorkflowRunCleanupServiceTests.cs</c> uses directly, just exercised
/// here through the real HTTP pipeline (start = one request, poll = a separate request, separate
/// DI scope each — the exact split the Singleton design exists for).
/// </summary>
public class WorkflowsEndpointsTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private WebApplicationFactory<Program> WithFakeGitHubClient(FakeHttpMessageHandler handler) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddScoped<GitHubClientFactory>(_ => new FakeGitHubClientFactory(handler));
        }));

    private WebApplicationFactory<Program> WithFakeCleanupService(FakeHttpMessageHandler handler) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            IGitHubClient BuildClient(string token) => new GitHubClient(new Connection(
                new Octokit.ProductHeaderValue("GithubVariablesManagerTests"),
                new Uri("https://api.github.com"),
                new InMemoryCredentialStore(new Credentials(token)),
                new HttpClientAdapter(() => handler),
                new SimpleJsonSerializer()));
            services.AddSingleton<WorkflowRunCleanupService>(_ => new WorkflowRunCleanupService(BuildClient));
        }));

    private static HttpClient AuthedClient(WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "some-token");
        return client;
    }

    private const string WorkflowsJson = """
        {"total_count":1,"workflows":[{"id":1,"name":"CI","path":".github/workflows/ci.yml","state":"active"}]}
        """;

    private const string RunsJson = """
        {"total_count":1,"workflow_runs":[{"id":501,"name":"CI","status":"completed","conclusion":"success","run_number":7,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:05:00Z","html_url":"https://github.com/acme-corp/widgets/actions/runs/501"}]}
        """;

    private const string RunDetailJson = """
        {"id":501,"name":"CI","status":"completed","conclusion":"success","run_number":7,
        "run_attempt":1,"event":"push","display_title":"Merge pull request #42",
        "head_branch":"main","head_sha":"abc123",
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:05:00Z",
        "run_started_at":"2026-01-01T00:01:00Z",
        "html_url":"https://github.com/acme-corp/widgets/actions/runs/501",
        "actor":{"login":"octocat","avatar_url":"https://avatars.example/octocat.png"},
        "head_commit":{"message":"Fix bug in parser\n\nSome longer body text here."}}
        """;

    private const string JobsJson = """
        {"total_count":1,"jobs":[{"id":9001,"name":"build","status":"completed","conclusion":"success","started_at":"2026-01-01T00:01:00Z","completed_at":"2026-01-01T00:04:00Z","steps":[{"name":"Checkout","number":1,"status":"completed","conclusion":"success","started_at":"2026-01-01T00:01:00Z","completed_at":"2026-01-01T00:02:00Z"}]}]}
        """;

    [Fact]
    public async Task Workflows_ValidToken_ReturnsCamelCasedWorkflows()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, WorkflowsJson);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/workflows?org=octo-org&repo=widgets");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"id\":1", body);
        Assert.Contains("\"name\":\"CI\"", body);
        Assert.Contains("\"path\":\".github/workflows/ci.yml\"", body);
        Assert.Contains("\"state\":\"active\"", body);
    }

    [Fact]
    public async Task Workflows_LockedScope_GoesThroughGlobalExceptionHandler()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NotFound, """
            {"message":"Not Found"}
            """);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/workflows?org=octo-org&repo=widgets");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"locked\":true", body);
        Assert.Contains("\"status\":404", body);
    }

    [Fact]
    public async Task Workflows_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/workflows?org=octo-org&repo=widgets");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"Missing bearer token.\"", body);
    }

    [Fact]
    public async Task WorkflowRuns_ValidToken_ReturnsCamelCasedRuns()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, RunsJson);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/workflows/runs?org=octo-org&repo=widgets&workflowId=1&perPage=30");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"id\":501", body);
        Assert.Contains("\"status\":\"completed\"", body);
        Assert.Contains("\"conclusion\":\"success\"", body);
        Assert.Contains("\"runNumber\":7", body);
        Assert.Contains("\"htmlUrl\":\"https://github.com/acme-corp/widgets/actions/runs/501\"", body);
    }

    [Fact]
    public async Task WorkflowRuns_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/workflows/runs?org=octo-org&repo=widgets&workflowId=1&perPage=30");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"Missing bearer token.\"", body);
    }

    [Fact]
    public async Task DeleteWorkflowRun_ValidToken_Deletes()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.DeleteAsync("/api/workflows/runs?org=octo-org&repo=widgets&runId=501");

        response.EnsureSuccessStatusCode();
        Assert.Equal(HttpMethod.Delete, Assert.Single(handler.RequestedMethods));
        var requestedPath = Assert.Single(handler.RequestedPaths);
        Assert.Contains("/repos/octo-org/widgets/actions/runs/501", requestedPath);
    }

    [Fact]
    public async Task DeleteWorkflowRun_LockedScope_GoesThroughGlobalExceptionHandler()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NotFound, """
            {"message":"Not Found"}
            """);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.DeleteAsync("/api/workflows/runs?org=octo-org&repo=widgets&runId=501");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"locked\":true", body);
        Assert.Contains("\"status\":404", body);
    }

    [Fact]
    public async Task DeleteWorkflowRun_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.DeleteAsync("/api/workflows/runs?org=octo-org&repo=widgets&runId=501");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"Missing bearer token.\"", body);
    }

    [Fact]
    public async Task WorkflowRunDetail_ValidToken_ReturnsCamelCasedDetailWithJobsAndSteps()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, RunDetailJson)
            .Enqueue(HttpStatusCode.OK, JobsJson);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/workflows/runs/501?org=octo-org&repo=widgets");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"id\":501", body);
        Assert.Contains("\"displayTitle\":\"Merge pull request #42\"", body);
        Assert.Contains("\"commitMessage\":\"Fix bug in parser\"", body);
        Assert.Contains("\"actorLogin\":\"octocat\"", body);
        Assert.Contains("\"jobs\":[{", body);
        Assert.Contains("\"steps\":[{", body);
    }

    [Fact]
    public async Task WorkflowRunDetail_LockedScope_GoesThroughGlobalExceptionHandler()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NotFound, """
            {"message":"Not Found"}
            """);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/workflows/runs/501?org=octo-org&repo=widgets");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"locked\":true", body);
        Assert.Contains("\"status\":404", body);
    }

    [Fact]
    public async Task WorkflowRunDetail_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/workflows/runs/501?org=octo-org&repo=widgets");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"Missing bearer token.\"", body);
    }

    [Fact]
    public async Task RerunWorkflowRun_ValidToken_Reruns()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Created, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PostAsync("/api/workflows/runs/rerun?org=octo-org&repo=widgets&runId=501", null);

        response.EnsureSuccessStatusCode();
        Assert.Equal(HttpMethod.Post, Assert.Single(handler.RequestedMethods));
        var requestedPath = Assert.Single(handler.RequestedPaths);
        Assert.Contains("/repos/octo-org/widgets/actions/runs/501/rerun", requestedPath);
    }

    [Fact]
    public async Task RerunWorkflowRun_LockedScope_GoesThroughGlobalExceptionHandler()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NotFound, """
            {"message":"Not Found"}
            """);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PostAsync("/api/workflows/runs/rerun?org=octo-org&repo=widgets&runId=501", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"locked\":true", body);
        Assert.Contains("\"status\":404", body);
    }

    [Fact]
    public async Task RerunWorkflowRun_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsync("/api/workflows/runs/rerun?org=octo-org&repo=widgets&runId=501", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"Missing bearer token.\"", body);
    }

    [Fact]
    public async Task StartCleanup_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/workflows/runs/cleanup",
            new StartWorkflowRunCleanupRequest("octo-org", "widgets", 1, [1, 2, 3]));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"Missing bearer token.\"", body);
    }

    [Fact]
    public async Task GetCleanupProgress_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync($"/api/workflows/runs/cleanup/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"Missing bearer token.\"", body);
    }

    [Fact]
    public async Task GetCleanupProgress_UnknownJobId_Returns404()
    {
        var client = AuthedClient(factory);

        var response = await client.GetAsync($"/api/workflows/runs/cleanup/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task StartCleanup_ThenPoll_CompletesWithAllSucceededIds()
    {
        var handler = new FakeHttpMessageHandler();
        var runIds = new long[] { 1, 2, 3 };
        foreach (var _ in runIds) handler.Enqueue(HttpStatusCode.NoContent, "{}");
        var client = AuthedClient(WithFakeCleanupService(handler));

        var startResponse = await client.PostAsJsonAsync("/api/workflows/runs/cleanup",
            new StartWorkflowRunCleanupRequest("octo-org", "widgets", 99, runIds));

        Assert.Equal(HttpStatusCode.Accepted, startResponse.StatusCode);
        var started = await startResponse.Content.ReadFromJsonAsync<StartWorkflowRunCleanupResponse>();
        Assert.NotNull(started);

        var progress = await PollUntilCompletedAsync(client, started!.JobId);

        Assert.Equal(3, progress.Done);
        Assert.Equal(3, progress.Total);
        Assert.True(progress.Completed);
        Assert.Equal(runIds.ToHashSet(), progress.SucceededIds.ToHashSet());
        Assert.Empty(progress.FailedIds);
        Assert.False(progress.PermissionDenied);
    }

    private static async Task<WorkflowRunCleanupProgressResponse> PollUntilCompletedAsync(
        HttpClient client, Guid jobId, TimeSpan? timeout = null)
    {
        var deadline = DateTimeOffset.UtcNow + (timeout ?? TimeSpan.FromSeconds(2));
        while (true)
        {
            var response = await client.GetAsync($"/api/workflows/runs/cleanup/{jobId}");
            response.EnsureSuccessStatusCode();
            var progress = await response.Content.ReadFromJsonAsync<WorkflowRunCleanupProgressResponse>();
            Assert.NotNull(progress);
            if (progress!.Completed) return progress;
            if (DateTimeOffset.UtcNow > deadline)
                Assert.Fail($"Job {jobId} did not complete within the bounded poll window (Done={progress.Done}/{progress.Total}).");
            await Task.Delay(50);
        }
    }
}
