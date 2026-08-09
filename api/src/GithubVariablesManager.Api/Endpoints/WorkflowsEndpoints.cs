using GithubVariablesManager.Api.Auth;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Endpoints;

/// <summary>
/// The Workflows vertical's routes — list a repo's Actions workflows, list/delete a workflow's
/// runs, and the chunked bulk-run-delete's start+poll pair. Repeats the same missing-bearer-token
/// 401 guard <c>RunnersEndpoints.cs</c>/<c>ScopesEndpoints.cs</c> use, inlined per-handler rather
/// than extracted into shared middleware/a filter (rule of three not yet hit).
/// <c>DELETE /api/workflows/runs</c> takes query params, not a body, matching
/// <c>LedgerEndpoints.cs</c>'s bodyless-DELETE convention exactly.
/// </summary>
public static class WorkflowsEndpoints
{
    public static void MapWorkflowsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/workflows");

        group.MapGet("", async (string org, string repo, IBearerTokenAccessor tokenAccessor, WorkflowsService workflowsService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            return Results.Ok(await workflowsService.ListWorkflowsAsync(org, repo));
        })
            .WithName("ListWorkflows")
            .WithTags("Workflows")
            .WithSummary("List a repository's Actions workflows (fully paginated).")
            .Produces<IReadOnlyList<WorkflowResponse>>(200)
            .Produces<ErrorResponse>(401);

        group.MapGet("/runs", async (string org, string repo, long workflowId, int perPage, IBearerTokenAccessor tokenAccessor, WorkflowsService workflowsService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            return Results.Ok(await workflowsService.ListWorkflowRunsAsync(org, repo, workflowId, perPage));
        })
            .WithName("ListWorkflowRuns")
            .WithTags("Workflows")
            .WithSummary("List a workflow's runs (single page, caller-supplied page size).")
            .Produces<IReadOnlyList<WorkflowRunResponse>>(200)
            .Produces<ErrorResponse>(401);

        group.MapDelete("/runs", async (string org, string repo, long runId, IBearerTokenAccessor tokenAccessor, WorkflowsService workflowsService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            await workflowsService.DeleteWorkflowRunAsync(org, repo, runId);
            return Results.Ok();
        })
            .WithName("DeleteWorkflowRun")
            .WithTags("Workflows")
            .WithSummary("Delete a single workflow run.")
            .Produces(200)
            .Produces<ErrorResponse>(401);

        group.MapPost("/runs/cleanup", (StartWorkflowRunCleanupRequest request, IBearerTokenAccessor tokenAccessor, WorkflowRunCleanupService cleanupService) =>
        {
            var token = tokenAccessor.GetToken();
            if (token is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            var jobId = cleanupService.StartCleanup(request.Org, request.Repo, request.WorkflowId, request.RunIds, token);
            return Results.Json(new StartWorkflowRunCleanupResponse(jobId), statusCode: 202);
        })
            .WithName("StartWorkflowRunCleanup")
            .WithTags("Workflows")
            .WithSummary("Start a chunked bulk-delete of workflow runs, returning a job id to poll.")
            .Produces<StartWorkflowRunCleanupResponse>(202)
            .Produces<ErrorResponse>(401);

        group.MapGet("/runs/cleanup/{jobId:guid}", (Guid jobId, IBearerTokenAccessor tokenAccessor, WorkflowRunCleanupService cleanupService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            var progress = cleanupService.GetProgress(jobId);
            return progress is null ? Results.NotFound() : Results.Ok(progress);
        })
            .WithName("GetWorkflowRunCleanupProgress")
            .WithTags("Workflows")
            .WithSummary("Poll a bulk-delete job's progress; 404 once the job id is no longer known (job state doesn't survive a backend restart).")
            .Produces<WorkflowRunCleanupProgressResponse>(200)
            .Produces(404)
            .Produces<ErrorResponse>(401);
    }
}
