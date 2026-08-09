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

    private static WorkflowResponse ToWorkflowResponse(Workflow w) =>
        new(w.Id, w.Name, w.Path, w.State.StringValue);

    private static WorkflowRunResponse ToWorkflowRunResponse(WorkflowRun r) =>
        new(r.Id, r.Name, r.Status.StringValue, r.Conclusion?.StringValue, r.RunNumber, r.CreatedAt, r.UpdatedAt, r.HtmlUrl);
}
