using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using Octokit;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// GitHub Actions workflows + their runs, for the Workflows view's list-workflows/list-runs/
/// single-run-delete needs. Octokit.NET does have a real typed client for this
/// (<c>Actions.Workflows</c>/<c>Actions.Workflows.Runs</c>, confirmed via reflection against the
/// installed 14.0.0 assembly), so — same as <see cref="RunnersService"/> — no
/// <see cref="ActionsRestClient"/> involvement is needed here. No try/catch on the single-run
/// delete — a bad/expired token or a locked (403/404) repo surfaces as
/// <see cref="Octokit.ApiException"/>, which propagates to the global
/// <see cref="Auth.PermissionErrorExceptionHandler"/> uncaught, same as every other single-item
/// mutation in this backend. The bulk-delete path lives in
/// <see cref="WorkflowRunCleanupService"/> instead, since it needs job state to survive across
/// requests.
/// </summary>
public sealed class WorkflowsService(GitHubClientFactory gitHubClientFactory)
{
    /// <summary>
    /// Fully paginates — unlike <see cref="RunnersService.ListRunnersAsync"/>'s single-page cap,
    /// this preserves the pre-migration Angular Gateway's (<c>GithubWorkflowsGateway.service.ts</c>)
    /// full-pagination behavior exactly. <c>Actions.Workflows.List</c> does not auto-merge pages the
    /// way <c>Repository.GetAllForOrg</c> does, so this loops it manually, total-count-driven, the
    /// same idea as <see cref="ActionsRestClient"/>'s private <c>Paginate&lt;TItem&gt;</c> helper.
    /// </summary>
    public async Task<IReadOnlyList<WorkflowResponse>> ListWorkflowsAsync(string org, string repo)
    {
        var workflows = gitHubClientFactory.CreateForCurrentUser().Actions.Workflows;
        var all = new List<Workflow>();
        var page = 1;
        while (true)
        {
            var response = await workflows.List(org, repo, new ApiOptions { StartPage = page, PageSize = 100 });
            all.AddRange(response.Workflows);
            if (response.Workflows.Count == 0 || all.Count >= response.TotalCount) break;
            page += 1;
        }
        return all.Select(ToWorkflowResponse).ToList();
    }

    /// <summary>
    /// A single page of the most recent runs, newest first — matches the pre-migration Angular
    /// Gateway's <c>ListWorkflowRuns</c> (display + selection, never paginated further).
    /// </summary>
    public async Task<IReadOnlyList<WorkflowRunResponse>> ListWorkflowRunsAsync(string org, string repo, long workflowId, int perPage)
    {
        var runs = gitHubClientFactory.CreateForCurrentUser().Actions.Workflows.Runs;
        var response = await runs.ListByWorkflow(org, repo, workflowId, new WorkflowRunsRequest(), new ApiOptions { PageSize = perPage, PageCount = 1 });
        return response.WorkflowRuns.Select(ToWorkflowRunResponse).ToList();
    }

    public async Task DeleteWorkflowRunAsync(string org, string repo, long runId)
    {
        await gitHubClientFactory.CreateForCurrentUser().Actions.Workflows.Runs.Delete(org, repo, runId);
    }

    /// <summary>
    /// One run's full detail: the run itself plus every job (each with its steps), for the run
    /// detail panel. The jobs list fully paginates (same total-count-driven loop as
    /// <see cref="ListWorkflowsAsync"/>) since a detail view's whole point is completeness — unlike
    /// <see cref="ListWorkflowRunsAsync"/>'s deliberate single-page cap for the run list.
    /// </summary>
    public async Task<WorkflowRunDetailResponse> GetWorkflowRunDetailAsync(string org, string repo, long runId)
    {
        var client = gitHubClientFactory.CreateForCurrentUser();
        var run = await client.Actions.Workflows.Runs.Get(org, repo, runId);

        var jobs = new List<WorkflowJob>();
        var page = 1;
        while (true)
        {
            var response = await client.Actions.Workflows.Jobs.List(
                org, repo, runId, new WorkflowRunJobsRequest(), new ApiOptions { StartPage = page, PageSize = 100 });
            jobs.AddRange(response.Jobs);
            if (response.Jobs.Count == 0 || jobs.Count >= response.TotalCount) break;
            page += 1;
        }

        return ToWorkflowRunDetailResponse(run, jobs);
    }

    public async Task RerunWorkflowRunAsync(string org, string repo, long runId)
    {
        await gitHubClientFactory.CreateForCurrentUser().Actions.Workflows.Runs.Rerun(org, repo, runId);
    }

    private static WorkflowResponse ToWorkflowResponse(Workflow w) =>
        new(w.Id, w.Name, w.Path, w.State.StringValue);

    private static WorkflowRunResponse ToWorkflowRunResponse(WorkflowRun r) =>
        new(r.Id, r.Name, r.Status.StringValue, r.Conclusion?.StringValue, r.RunNumber, r.CreatedAt, r.UpdatedAt, r.HtmlUrl,
            ExtractCommitSubject(r.HeadCommit?.Message));

    private static WorkflowRunDetailResponse ToWorkflowRunDetailResponse(WorkflowRun r, IReadOnlyList<WorkflowJob> jobs) =>
        new(r.Id, r.Name, r.DisplayTitle, ExtractCommitSubject(r.HeadCommit?.Message),
            r.Status.StringValue, r.Conclusion?.StringValue, r.Event,
            r.RunNumber, r.RunAttempt, r.HeadBranch, r.HeadSha,
            r.Actor?.Login, r.Actor?.AvatarUrl,
            r.CreatedAt, r.UpdatedAt, r.RunStartedAt,
            r.HtmlUrl, jobs.Select(ToWorkflowRunJobResponse).ToList());

    private static WorkflowRunJobResponse ToWorkflowRunJobResponse(WorkflowJob j) =>
        new(j.Id, j.Name, j.Status.StringValue, j.Conclusion?.StringValue, j.StartedAt, j.CompletedAt,
            j.Steps.Select(ToWorkflowRunJobStepResponse).ToList());

    private static WorkflowRunJobStepResponse ToWorkflowRunJobStepResponse(WorkflowJobStep s) =>
        new(s.Name, s.Number, s.Status.StringValue, s.Conclusion?.StringValue, s.StartedAt, s.CompletedAt);

    /// <summary>
    /// The commit message's first line (git-subject-line convention) — deliberately not
    /// <see cref="WorkflowRun.DisplayTitle"/>, which is GitHub's own computed title and silently
    /// changes if the workflow YAML sets <c>run-name:</c>.
    /// </summary>
    private static string? ExtractCommitSubject(string? fullMessage)
    {
        if (string.IsNullOrWhiteSpace(fullMessage)) return null;
        var firstLine = fullMessage.Split('\n')[0].Trim();
        return firstLine.Length == 0 ? null : firstLine;
    }
}
