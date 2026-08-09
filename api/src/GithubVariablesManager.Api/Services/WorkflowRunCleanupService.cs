using System.Collections.Concurrent;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Bulk-deletes a caller-chosen set of a workflow's runs, in small concurrent chunks, tracking
/// progress in memory so a client can poll it — start+poll instead of SSE/WebSocket, per this
/// phase's plan. Registered <c>AddSingleton</c>, not <c>AddScoped</c> like every other Service in
/// this backend, and that split is load-bearing, not a style choice: the "start" request and every
/// "poll" request that follows are separate HTTP requests with separate DI scopes, so job state
/// that needs to survive between them cannot live in a Scoped service. Because it's Singleton, it
/// deliberately does NOT constructor-inject <see cref="GitHubClientFactory"/> or
/// <see cref="Auth.IBearerTokenAccessor"/> — both are Scoped/HttpContext-bound and would misbehave
/// (or throw) if captured by a Singleton. Instead the caller's bearer token is passed in as a plain
/// string parameter to <see cref="StartCleanup"/>, captured from the *real* request's scope (where
/// the endpoint handler legitimately has <see cref="Auth.IBearerTokenAccessor"/>), and used to build
/// a one-off Octokit client via <see cref="OctokitClientBuilder"/> for the background job.
///
/// Two honest caveats this design accepts, worth being explicit about rather than glossing over:
///
/// 1. <b>The bearer token is held as a plain in-memory string</b> on the job's <see cref="JobState"/>
///    for the duration of that one background job — typically seconds, bounded by how many runs
///    were selected. It is never logged, never written to disk, and never survives a process
///    restart; it's discarded (with the rest of the job) once the job is evicted. This is a real,
///    deliberate departure from this backend's usual "a token never outlives one request" shape —
///    accepted here because there is no other way to give a background <c>Task.Run</c> continuation
///    the credentials it needs once the original HTTP request has already returned its 202.
/// 2. <b>In-memory job state does not survive a backend restart.</b> If the process restarts
///    mid-job, polling that job's id afterward returns 404 (see <see cref="GetProgress"/>) — the
///    client is expected to treat a 404 from its poll as a hard failure and stop polling, not loop
///    forever. There is no way to reconcile "some runs may already be deleted on GitHub" after that;
///    it's an accepted tradeoff of keeping this backend free of any database, per this project's
///    "no server-side database, ever" rule.
/// </summary>
public sealed class WorkflowRunCleanupService(Func<string, Octokit.IGitHubClient>? gitHubClientBuilder = null)
{
    private const int ChunkSize = 5;
    private readonly ConcurrentDictionary<Guid, JobState> jobs = new();

    // Defaults to the real OctokitClientBuilder.BuildFor. This Singleton can't take a
    // GitHubClientFactory the way every Scoped service does (see class doc comment above), so a
    // test that needs to point at a FakeHttpMessageHandler instead substitutes this delegate — the
    // same test-seam idea as GitHubClientFactory's own overridable CreateForCurrentUser
    // (RunnersServiceTests/WorkflowsServiceTests), just shaped as a constructor parameter here.
    // ASP.NET Core's DI container falls back to this optional parameter's default (null) when
    // resolving the Singleton normally, so Program.cs's registration needs no change.
    private readonly Func<string, Octokit.IGitHubClient> buildClient = gitHubClientBuilder ?? OctokitClientBuilder.BuildFor;

    private sealed class JobState
    {
        public int Total;
        public int Done;
        public volatile bool Completed;
        public readonly ConcurrentBag<long> SucceededIds = [];
        public readonly ConcurrentBag<long> FailedIds = [];
        public volatile bool PermissionDenied;
        public DateTimeOffset CreatedAt = DateTimeOffset.UtcNow;
    }

    public Guid StartCleanup(string org, string repo, long workflowId, IReadOnlyList<long> runIds, string bearerToken)
    {
        EvictStaleJobs();
        var jobId = Guid.NewGuid();
        var job = new JobState { Total = runIds.Count };
        jobs[jobId] = job;
        _ = Task.Run(() => RunJobAsync(job, org, repo, runIds, bearerToken));
        return jobId;
    }

    public WorkflowRunCleanupProgressResponse? GetProgress(Guid jobId)
    {
        if (!jobs.TryGetValue(jobId, out var job)) return null;
        return new WorkflowRunCleanupProgressResponse(job.Done, job.Total, job.Completed, job.SucceededIds.ToList(), job.FailedIds.ToList(), job.PermissionDenied);
    }

    private async Task RunJobAsync(JobState job, string org, string repo, IReadOnlyList<long> runIds, string bearerToken)
    {
        try
        {
            var client = buildClient(bearerToken);
            foreach (var chunk in runIds.Chunk(ChunkSize))
            {
                await Task.WhenAll(chunk.Select(runId => DeleteOneAsync(client, job, org, repo, runId)));
            }
        }
        catch
        {
            // Top-level catch: an uncaught exception inside a fire-and-forget Task.Run becomes a
            // silently-lost unobserved task exception in modern .NET, which would leave a poller
            // hanging forever against a job that's actually dead. Mark it complete with whatever
            // was collected so far so polling terminates instead of hanging.
        }
        finally
        {
            job.Completed = true;
        }
    }

    private static async Task DeleteOneAsync(Octokit.IGitHubClient client, JobState job, string org, string repo, long runId)
    {
        try
        {
            await client.Actions.Workflows.Runs.Delete(org, repo, runId);
            job.SucceededIds.Add(runId);
        }
        catch (Octokit.ApiException ex)
        {
            job.FailedIds.Add(runId);
            // Reuse the centralized classifier rather than hand-rolling a status check — this
            // phase retires the last of the four originally-duplicated permission-classification
            // sites; don't quietly create a fifth one here.
            if (Auth.PermissionErrorClassifier.Classify((int)ex.StatusCode, ex.Message).Locked)
                job.PermissionDenied = true;
        }
        finally
        {
            Interlocked.Increment(ref job.Done);
        }
    }

    private void EvictStaleJobs()
    {
        var cutoff = DateTimeOffset.UtcNow.AddMinutes(-10);
        foreach (var (id, job) in jobs)
            if (job.Completed && job.CreatedAt < cutoff)
                jobs.TryRemove(id, out _);
    }
}
