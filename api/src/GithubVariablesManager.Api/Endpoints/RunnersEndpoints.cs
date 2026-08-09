using GithubVariablesManager.Api.Auth;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Endpoints;

/// <summary>
/// The Runners vertical's routes — self-hosted runners for the dashboard's runners panel. A single
/// <c>GET /api/runners</c> with an optional <c>repo</c> query param covers both scopes: org-only
/// (<c>repo</c> omitted) and repo (<c>repo</c> present) — the branching that used to live in
/// Angular's <c>RunnersFacade</c> now lives in <see cref="Services.RunnersService"/>. Repeats the
/// same missing-bearer-token 401 guard <c>ScopesEndpoints.cs</c>/<c>AuthEndpoints.cs</c> use,
/// inlined per-handler rather than extracted into shared middleware/a filter (rule of three not yet
/// hit).
/// </summary>
public static class RunnersEndpoints
{
    public static void MapRunnersEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/runners");

        group.MapGet("", async (string org, string? repo, IBearerTokenAccessor tokenAccessor, RunnersService runnersService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            return Results.Ok(await runnersService.ListRunnersAsync(org, repo));
        })
            .WithName("ListRunners")
            .WithTags("Runners")
            .WithSummary("List self-hosted runners for an org, or a repo when the `repo` query param is present.")
            .Produces<IReadOnlyList<RunnerResponse>>(200)
            .Produces<ErrorResponse>(401);
    }
}
