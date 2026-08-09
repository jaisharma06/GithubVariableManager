using GithubVariablesManager.Api.Auth;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Endpoints;

/// <summary>
/// The Scopes vertical's routes — orgs/repos lookup for the scope picker, plus the account-type
/// check. Each handler repeats the same missing-bearer-token 401 guard AuthEndpoints.cs's
/// GET /viewer uses (a *missing* header can't go through PermissionErrorExceptionHandler, since
/// that only fires once an Octokit.ApiException has actually been thrown). Inlined per-handler
/// rather than extracted into shared middleware/a filter — only two verticals need this guard so
/// far; extract once a third does (rule of three).
/// </summary>
public static class ScopesEndpoints
{
    public static void MapScopesEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/scopes");

        group.MapGet("/orgs", async (IBearerTokenAccessor tokenAccessor, ScopesService scopesService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            return Results.Ok(await scopesService.ListMyOrgsAsync());
        })
            .WithName("ListMyOrgs")
            .WithTags("Scopes")
            .WithSummary("List organizations the caller belongs to (single page, up to 100).")
            .Produces<IReadOnlyList<OrgResponse>>(200)
            .Produces<ErrorResponse>(401);

        group.MapGet("/repos", async (IBearerTokenAccessor tokenAccessor, ScopesService scopesService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            return Results.Ok(await scopesService.ListMyReposAsync());
        })
            .WithName("ListMyRepos")
            .WithTags("Scopes")
            .WithSummary("List repositories the caller can access (single page, up to 100).")
            .Produces<IReadOnlyList<RepoResponse>>(200)
            .Produces<ErrorResponse>(401);

        group.MapGet("/orgs/{org}/repos", async (string org, IBearerTokenAccessor tokenAccessor, ScopesService scopesService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            return Results.Ok(await scopesService.ListOrgReposAsync(org));
        })
            .WithName("ListOrgRepos")
            .WithTags("Scopes")
            .WithSummary("List every repository in an organization (fully paginated).")
            .Produces<IReadOnlyList<RepoResponse>>(200)
            .Produces<ErrorResponse>(401);

        group.MapGet("/accounts/{login}/type", async (string login, IBearerTokenAccessor tokenAccessor, ScopesService scopesService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            return Results.Ok(await scopesService.GetAccountTypeAsync(login));
        })
            .WithName("GetAccountType")
            .WithTags("Scopes")
            .WithSummary("Get whether a login is a User or Organization account.")
            .Produces<AccountTypeResponse>(200)
            .Produces<ErrorResponse>(401);
    }
}
