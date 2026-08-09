using System.Net;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.Services;
using Octokit;
using Octokit.Internal;

namespace GithubVariablesManager.Api.Tests.Services;

/// <summary>
/// Exercises the chunked bulk-run-delete's job-tracking directly against
/// <see cref="WorkflowRunCleanupService"/>'s <c>Func&lt;string, IGitHubClient&gt;</c> test seam
/// (see that class's doc comment), bypassing HTTP entirely. This is the first genuinely concurrent
/// consumer of <see cref="FakeHttpMessageHandler"/> (a per-chunk <c>Task.WhenAll</c> of up to 5
/// simultaneous deletes) — if these tests are flaky, that is a real signal, not a fixture to retry
/// away; see FakeHttpMessageHandler.cs's own doc comment about the locking fix it required.
/// </summary>
public class WorkflowRunCleanupServiceTests
{
    private static (WorkflowRunCleanupService Service, FakeHttpMessageHandler Handler) CreateService()
    {
        var handler = new FakeHttpMessageHandler();
        IGitHubClient BuildClient(string token) => new GitHubClient(new Connection(
            new ProductHeaderValue("GithubVariablesManagerTests"),
            new Uri("https://api.github.com"),
            new InMemoryCredentialStore(new Credentials(token)),
            new HttpClientAdapter(() => handler),
            new SimpleJsonSerializer()));
        return (new WorkflowRunCleanupService(BuildClient), handler);
    }

    private static async Task<WorkflowRunCleanupProgressResponse> PollUntilCompletedAsync(
        WorkflowRunCleanupService service, Guid jobId, TimeSpan? timeout = null)
    {
        var deadline = DateTimeOffset.UtcNow + (timeout ?? TimeSpan.FromSeconds(2));
        while (true)
        {
            var progress = service.GetProgress(jobId);
            Assert.NotNull(progress);
            if (progress.Completed) return progress;
            if (DateTimeOffset.UtcNow > deadline)
                Assert.Fail($"Job {jobId} did not complete within the bounded poll window (Done={progress.Done}/{progress.Total}).");
            await Task.Delay(50);
        }
    }

    [Fact]
    public async Task StartCleanup_AllSucceed_ReportsDoneEqualsTotal_AndAllSucceededIds()
    {
        var (service, handler) = CreateService();
        var runIds = new long[] { 1, 2, 3, 4, 5, 6, 7 }; // 2 chunks: 5 + 2
        foreach (var _ in runIds) handler.Enqueue(HttpStatusCode.NoContent, "{}");

        var jobId = service.StartCleanup("octo-org", "widgets", 99, runIds, "test-token");
        var progress = await PollUntilCompletedAsync(service, jobId);

        Assert.Equal(7, progress.Done);
        Assert.Equal(7, progress.Total);
        Assert.True(progress.Completed);
        Assert.Equal(runIds.ToHashSet(), progress.SucceededIds.ToHashSet());
        Assert.Empty(progress.FailedIds);
        Assert.False(progress.PermissionDenied);
    }

    [Fact]
    public async Task StartCleanup_OneRunForbidden_EndsUpInFailedIds_AndFlagsPermissionDenied()
    {
        var (service, handler) = CreateService();
        var runIds = new long[] { 1, 2, 3, 4, 5, 6, 7 };
        handler.Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        for (var i = 0; i < runIds.Length - 1; i++) handler.Enqueue(HttpStatusCode.NoContent, "{}");

        var jobId = service.StartCleanup("octo-org", "widgets", 99, runIds, "test-token");
        var progress = await PollUntilCompletedAsync(service, jobId);

        Assert.Equal(7, progress.Done);
        Assert.Single(progress.FailedIds);
        Assert.Equal(6, progress.SucceededIds.Count);
        Assert.True(progress.PermissionDenied);
    }

    [Fact]
    public async Task StartCleanup_OneRunNotFound_EndsUpInFailedIds_AndFlagsPermissionDenied()
    {
        // The classifier treats 404 the same as 403 (Auth.PermissionErrorClassifier.Classify) —
        // both mean "locked" from the caller's point of view.
        var (service, handler) = CreateService();
        var runIds = new long[] { 1, 2, 3, 4, 5, 6, 7 };
        handler.Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""");
        for (var i = 0; i < runIds.Length - 1; i++) handler.Enqueue(HttpStatusCode.NoContent, "{}");

        var jobId = service.StartCleanup("octo-org", "widgets", 99, runIds, "test-token");
        var progress = await PollUntilCompletedAsync(service, jobId);

        Assert.Equal(7, progress.Done);
        Assert.Single(progress.FailedIds);
        Assert.Equal(6, progress.SucceededIds.Count);
        Assert.True(progress.PermissionDenied);
    }

    [Fact]
    public void GetProgress_UnknownJobId_ReturnsNull()
    {
        var (service, _) = CreateService();

        var progress = service.GetProgress(Guid.NewGuid());

        Assert.Null(progress);
    }
}
