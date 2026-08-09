using GithubVariablesManager.Api.Auth;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Endpoints;

/// <summary>
/// The Ledger vertical's routes. Phase 3c added Environments CRUD/rename (<c>GET</c>/
/// <c>POST</c>/<c>DELETE /api/ledger/environments</c>, <c>POST /api/ledger/environments/rename</c>),
/// closing out the vertical alongside the merged read, Variables CRUD (Phase 3a), and Secrets CRUD
/// (Phase 3b). Secrets use a single upsert-only <c>PUT</c> (no separate create endpoint — GitHub's
/// own secrets PUT is already upsert-only, unlike variables) and a single <c>PATCH</c> for rename
/// that reports a partial outcome in its response body rather than ever mapping to a 5xx — see
/// <see cref="Services.ItemMutationService.RenameSecretAsync"/>'s doc comment for why.
/// <c>POST /api/ledger/environments/rename</c> mirrors that same outcome-reporting philosophy — see
/// <see cref="Services.EnvironmentRenameService"/>'s doc comment. Its one difference: new-name
/// validation failures (nothing touched GitHub except a read) are a genuine 400 via
/// <see cref="EnvironmentRenameValidationException"/>, caught locally here rather than routed
/// through the global <see cref="Auth.PermissionErrorExceptionHandler"/> — this isn't a permission
/// error, mirroring the <see cref="LedgerUnavailableException"/> local-catch precedent above.
/// Missing-bearer-token 401 guard is inlined per-handler, same as <c>ScopesEndpoints</c>/
/// <c>AuthEndpoints</c> (rule of three not yet hit). <c>DELETE /api/ledger/variables</c>/
/// <c>secrets</c>/<c>environments</c> take query params, not a body, matching this codebase's
/// existing bodyless-DELETE convention.
///
/// Phase 6 adds the two batch endpoints, <c>POST /api/ledger/copy</c>/<c>POST
/// /api/ledger/delete-everywhere</c> — one endpoint per operation with internal <c>kind</c>
/// branching (<c>Services.CopyService</c>/<c>Services.DeleteEverywhereService</c>) rather than
/// separate per-kind endpoints, since splitting by kind would just push the kind-decision back into
/// Angular. They live on this same route group, not a new file, because Copy/Delete-everywhere
/// operate on the Ledger vertical's own resources (variables/secrets). This phase also removes
/// <c>PUT /api/ledger/variables</c> (upsert-by-name): it existed only for the old client-side
/// <c>CopyFacade.CopyTo</c>'s variable branch, which now calls <c>POST /api/ledger/copy</c> instead
/// — <see cref="Services.ItemMutationService.UpsertVariableAsync"/> itself is kept, since
/// <see cref="Services.EnvironmentRenameService"/> and <see cref="Services.CopyService"/> both still
/// call it in-process; only the externally-exposed HTTP route lost its last caller.
/// </summary>
public static class LedgerEndpoints
{
    private static readonly string[] ValidLevels = ["organization", "repository", "environment"];
    private static readonly string[] ValidKinds = ["variable", "secret"];

    public static void MapLedgerEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/ledger");

        group.MapGet("", async (string? org, string? repo, IBearerTokenAccessor tokenAccessor, LedgerService ledgerService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }
            if (string.IsNullOrWhiteSpace(org))
            {
                return Results.Json(new ErrorResponse("Missing org."), statusCode: 400);
            }

            try
            {
                var ledger = await ledgerService.GetLedgerAsync(org, repo);
                return Results.Ok(ledger);
            }
            catch (LedgerUnavailableException ex)
            {
                // Not itself an Octokit.ApiException (a synthesized aggregate over several
                // independent calls) — caught locally rather than going through the global
                // PermissionErrorExceptionHandler, mirroring OAuthRelayException's local-catch
                // precedent in AuthEndpoints.cs.
                return Results.Json(new ErrorResponse(ex.Message), statusCode: 502);
            }
        })
            .WithName("GetLedger")
            .WithTags("Ledger")
            .WithSummary("Get the merged variables + secrets view for a scope, fanned out across organization/repository/environment levels.")
            .Produces<LedgerResponse>(200)
            .Produces<ErrorResponse>(400)
            .Produces<ErrorResponse>(401)
            .Produces<ErrorResponse>(502);

        group.MapPost("/variables", async (CreateVariableRequest request, IBearerTokenAccessor tokenAccessor, ItemMutationService itemMutationService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }
            if (!ValidLevels.Contains(request.Level))
            {
                return Results.Json(new ErrorResponse("Invalid level."), statusCode: 400);
            }

            await itemMutationService.CreateVariableAsync(request.Org, request.Repo, request.Env, request.Level, request.Name, request.Value);
            return Results.Ok();
        })
            .WithName("CreateVariable")
            .WithTags("Ledger")
            .WithSummary("Create a new Actions variable at the given scope level.")
            .Produces(200)
            .Produces<ErrorResponse>(400)
            .Produces<ErrorResponse>(401);

        group.MapPatch("/variables", async (RenameVariableRequest request, IBearerTokenAccessor tokenAccessor, ItemMutationService itemMutationService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }
            if (!ValidLevels.Contains(request.Level))
            {
                return Results.Json(new ErrorResponse("Invalid level."), statusCode: 400);
            }

            await itemMutationService.UpdateVariableAsync(request.Org, request.Repo, request.Env, request.Level, request.CurrentName, request.NewName, request.Value);
            return Results.Ok();
        })
            .WithName("RenameVariable")
            .WithTags("Ledger")
            .WithSummary("Rename and/or update an existing Actions variable.")
            .Produces(200)
            .Produces<ErrorResponse>(400)
            .Produces<ErrorResponse>(401);

        group.MapDelete("/variables", async (string org, string? repo, string? env, string level, string name, IBearerTokenAccessor tokenAccessor, ItemMutationService itemMutationService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }
            if (!ValidLevels.Contains(level))
            {
                return Results.Json(new ErrorResponse("Invalid level."), statusCode: 400);
            }

            await itemMutationService.DeleteVariableAsync(org, repo, env, level, name);
            return Results.Ok();
        })
            .WithName("DeleteVariable")
            .WithTags("Ledger")
            .WithSummary("Delete an Actions variable.")
            .Produces(200)
            .Produces<ErrorResponse>(400)
            .Produces<ErrorResponse>(401);

        group.MapPut("/secrets", async (PutSecretRequest request, IBearerTokenAccessor tokenAccessor, ItemMutationService itemMutationService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }
            if (!ValidLevels.Contains(request.Level))
            {
                return Results.Json(new ErrorResponse("Invalid level."), statusCode: 400);
            }

            await itemMutationService.PutSecretAsync(request.Org, request.Repo, request.Env, request.Level, request.Name, request.Value, request.Visibility, request.SelectedRepositoryIds);
            return Results.Ok();
        })
            .WithName("PutSecret")
            .WithTags("Ledger")
            .WithSummary("Create or update an Actions secret (upsert — GitHub secrets have no separate create step).")
            .Produces(200)
            .Produces<ErrorResponse>(400)
            .Produces<ErrorResponse>(401);

        group.MapPatch("/secrets", async (RenameSecretRequest request, IBearerTokenAccessor tokenAccessor, ItemMutationService itemMutationService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }
            if (!ValidLevels.Contains(request.Level))
            {
                return Results.Json(new ErrorResponse("Invalid level."), statusCode: 400);
            }

            var result = await itemMutationService.RenameSecretAsync(request.Org, request.Repo, request.Env, request.Level, request.CurrentName, request.NewName, request.Value, request.Visibility, request.SelectedRepositoryIds);
            return Results.Ok(result);
        })
            .WithName("RenameSecret")
            .WithTags("Ledger")
            .WithSummary("Rename a secret (create-under-new-name then delete-old, since GitHub has no secret rename API); reports a partial-failure outcome instead of a 5xx if only the delete step fails.")
            .Produces<RenameSecretResponse>(200)
            .Produces<ErrorResponse>(400)
            .Produces<ErrorResponse>(401);

        group.MapDelete("/secrets", async (string org, string? repo, string? env, string level, string name, IBearerTokenAccessor tokenAccessor, ItemMutationService itemMutationService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }
            if (!ValidLevels.Contains(level))
            {
                return Results.Json(new ErrorResponse("Invalid level."), statusCode: 400);
            }

            await itemMutationService.DeleteSecretAsync(org, repo, env, level, name);
            return Results.Ok();
        })
            .WithName("DeleteSecret")
            .WithTags("Ledger")
            .WithSummary("Delete an Actions secret.")
            .Produces(200)
            .Produces<ErrorResponse>(400)
            .Produces<ErrorResponse>(401);

        group.MapGet("/environments", async (string org, string repo, IBearerTokenAccessor tokenAccessor, EnvironmentsService environmentsService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            var environments = await environmentsService.ListEnvironmentsAsync(org, repo);
            return Results.Ok(environments);
        })
            .WithName("ListEnvironments")
            .WithTags("Ledger")
            .WithSummary("List a repository's deployment environments.")
            .Produces<IReadOnlyList<EnvironmentResponse>>(200)
            .Produces<ErrorResponse>(401);

        group.MapPost("/environments", async (CreateEnvironmentRequest request, IBearerTokenAccessor tokenAccessor, EnvironmentsService environmentsService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            await environmentsService.CreateEnvironmentAsync(request.Org, request.Repo, request.Name);
            return Results.Ok();
        })
            .WithName("CreateEnvironment")
            .WithTags("Ledger")
            .WithSummary("Create a deployment environment.")
            .Produces(200)
            .Produces<ErrorResponse>(401);

        group.MapDelete("/environments", async (string org, string repo, string name, IBearerTokenAccessor tokenAccessor, EnvironmentsService environmentsService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            await environmentsService.DeleteEnvironmentAsync(org, repo, name);
            return Results.Ok();
        })
            .WithName("DeleteEnvironment")
            .WithTags("Ledger")
            .WithSummary("Delete a deployment environment.")
            .Produces(200)
            .Produces<ErrorResponse>(401);

        group.MapPost("/environments/rename", async (RenameEnvironmentRequest request, IBearerTokenAccessor tokenAccessor, EnvironmentRenameService environmentRenameService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            try
            {
                var result = await environmentRenameService.RenameEnvironmentAsync(request.Org, request.Repo, request.OldName, request.NewName, request.DeleteOldAnyway);
                return Results.Ok(result);
            }
            catch (EnvironmentRenameValidationException ex)
            {
                // Not an Octokit.ApiException (nothing touched GitHub except a read) — caught
                // locally rather than going through the global PermissionErrorExceptionHandler,
                // same reasoning as LedgerUnavailableException above.
                return Results.Json(new ErrorResponse(ex.Message), statusCode: 400);
            }
        })
            .WithName("RenameEnvironment")
            .WithTags("Ledger")
            .WithSummary("Rename an environment (create-new, copy every variable's value across, conditionally delete-old, since GitHub has no environment rename API); reports a partial outcome rather than a 5xx.")
            .Produces<RenameEnvironmentResponse>(200)
            .Produces<ErrorResponse>(400)
            .Produces<ErrorResponse>(401);

        group.MapPost("/copy", async (CopyRequest request, IBearerTokenAccessor tokenAccessor, CopyService copyService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }
            if (!ValidKinds.Contains(request.Kind))
            {
                return Results.Json(new ErrorResponse("Invalid kind."), statusCode: 400);
            }
            if (request.Targets.Count == 0)
            {
                return Results.Json(new ErrorResponse("No targets provided."), statusCode: 400);
            }
            if (request.Targets.Any(t => !ValidLevels.Contains(t.Level)))
            {
                return Results.Json(new ErrorResponse("Invalid level."), statusCode: 400);
            }

            var results = await copyService.CopyAsync(request.Kind, request.Name, request.Value, request.Visibility, request.SelectedRepositoryIds, request.Targets);
            return Results.Ok(new CopyResponse(results));
        })
            .WithName("CopyItem")
            .WithTags("Ledger")
            .WithSummary("Copy a variable or secret's value to one or more other scopes in a single batch call, reporting success/failure per target.")
            .Produces<CopyResponse>(200)
            .Produces<ErrorResponse>(400)
            .Produces<ErrorResponse>(401);

        group.MapPost("/delete-everywhere", async (DeleteEverywhereRequest request, IBearerTokenAccessor tokenAccessor, DeleteEverywhereService deleteEverywhereService) =>
        {
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }
            if (!ValidKinds.Contains(request.Kind))
            {
                return Results.Json(new ErrorResponse("Invalid kind."), statusCode: 400);
            }
            if (request.Targets.Count == 0)
            {
                return Results.Json(new ErrorResponse("No targets provided."), statusCode: 400);
            }
            if (request.Targets.Any(t => !ValidLevels.Contains(t.Level)))
            {
                return Results.Json(new ErrorResponse("Invalid level."), statusCode: 400);
            }

            var results = await deleteEverywhereService.DeleteAsync(request.Kind, request.Name, request.Targets);
            return Results.Ok(new DeleteEverywhereResponse(results));
        })
            .WithName("DeleteEverywhere")
            .WithTags("Ledger")
            .WithSummary("Delete a variable or secret by name from one or more scopes in a single batch call, reporting success/failure per target.")
            .Produces<DeleteEverywhereResponse>(200)
            .Produces<ErrorResponse>(400)
            .Produces<ErrorResponse>(401);
    }
}
