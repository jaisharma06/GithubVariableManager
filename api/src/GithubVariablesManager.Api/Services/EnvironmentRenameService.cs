using System.Text.RegularExpressions;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using Octokit;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Thrown when the new environment name itself is invalid (empty, bad pattern, same as old, or
/// already in use) — caught locally in <c>Endpoints/LedgerEndpoints.cs</c> as a genuine 400
/// (nothing touched GitHub except a read), not routed through the global
/// <see cref="Auth.PermissionErrorExceptionHandler"/>, mirroring the
/// <see cref="LedgerUnavailableException"/>/<see cref="OAuthRelayException"/> local-catch
/// precedent for exceptions that aren't <see cref="Octokit.ApiException"/>s.
/// </summary>
public sealed class EnvironmentRenameValidationException(string message) : Exception(message);

/// <summary>
/// GitHub has no rename API for environments — this is create-new, copy every environment-level
/// variable's value across, then conditionally delete-old, done server-side in one call now
/// instead of three sequential client-side mutations (create -> copy -> delete) that used to live
/// in <c>RenameEnvironmentDialog.component.ts</c>.
///
/// Outcome-reporting philosophy mirrors <see cref="ItemMutationService.RenameSecretAsync"/> exactly
/// — report exactly what happened, don't fake transactionality GitHub doesn't offer:
/// <list type="bullet">
/// <item>New-name validation fails -> nothing touched GitHub except a read -> a genuine 400
/// (<see cref="EnvironmentRenameValidationException"/>).</item>
/// <item>Environment creation fails -> the one step allowed to propagate
/// <see cref="Octokit.ApiException"/> uncaught to <see cref="Auth.PermissionErrorExceptionHandler"/>
/// — this is the point of no return.</item>
/// <item>Some variable copies fail -> the old environment is left in place, never deleted,
/// regardless of <c>deleteOldAnyway</c> — this is the exact safety behavior the old client-side
/// orchestration had, preserved here. Every step after environment creation is caught locally from
/// here on (never thrown uncaught) — GitHub already has new real state a 5xx would misrepresent.</item>
/// <item>All variable copies succeed but the conditional delete itself fails -> caught, reported via
/// <c>OldEnvironmentDeleted: false, OldEnvironmentDeleteError: "&lt;GitHub's message&gt;"</c>, still
/// 200 OK.</item>
/// </list>
/// </summary>
public sealed class EnvironmentRenameService(
    EnvironmentsService environmentsService,
    ActionsRestClient actionsRestClient,
    ItemMutationService itemMutationService)
{
    private static readonly Regex NamePattern = new("^[A-Za-z0-9_.-]+$", RegexOptions.Compiled);

    public async Task<RenameEnvironmentResponse> RenameEnvironmentAsync(
        string org, string repo, string oldName, string newName, bool deleteOldAnyway)
    {
        var trimmed = newName.Trim();
        if (trimmed.Length == 0 || !NamePattern.IsMatch(trimmed))
        {
            throw new EnvironmentRenameValidationException("Enter a valid environment name.");
        }
        if (trimmed == oldName)
        {
            throw new EnvironmentRenameValidationException("Choose a different name.");
        }

        var existing = await environmentsService.ListEnvironmentsAsync(org, repo);
        if (existing.Any(e => e.Name == trimmed))
        {
            throw new EnvironmentRenameValidationException("An environment with this name already exists.");
        }

        // Point of no return — only this call may propagate ApiException uncaught.
        await environmentsService.CreateEnvironmentAsync(org, repo, trimmed);

        List<RawVariable> variables;
        try
        {
            variables = (await actionsRestClient.ListVariablesAsync(org, repo, oldName, "environment")).ToList();
        }
        catch (ApiException ex)
        {
            return new RenameEnvironmentResponse(ex.Message, 0, [], false, null);
        }

        var copyFailures = new List<VariableCopyFailureResponse>();
        var copied = 0;
        foreach (var variable in variables)
        {
            try
            {
                await itemMutationService.UpsertVariableAsync(org, repo, trimmed, "environment", variable.Name, variable.Value);
                copied++;
            }
            catch (ApiException ex)
            {
                copyFailures.Add(new VariableCopyFailureResponse(variable.Name, ex.Message));
            }
        }
        if (copyFailures.Count > 0)
        {
            // Safety-critical: never delete the old environment when even one variable copy
            // failed, regardless of deleteOldAnyway — the old environment is the only remaining
            // source of truth for whatever didn't make it across.
            return new RenameEnvironmentResponse(null, copied, copyFailures, false, null);
        }

        var canDeleteOld = deleteOldAnyway || await NoSecretsPresentAsync(org, repo, oldName);
        if (!canDeleteOld)
        {
            return new RenameEnvironmentResponse(null, copied, [], false, null);
        }

        try
        {
            await environmentsService.DeleteEnvironmentAsync(org, repo, oldName);
            return new RenameEnvironmentResponse(null, copied, [], true, null);
        }
        catch (ApiException ex)
        {
            return new RenameEnvironmentResponse(null, copied, [], false, ex.Message);
        }
    }

    /// <summary>Conservative: if the secrets check itself fails, assume secrets exist ("can't tell") rather than risk deleting an environment that still has some.</summary>
    private async Task<bool> NoSecretsPresentAsync(string org, string repo, string env)
    {
        try
        {
            return (await actionsRestClient.ListSecretsAsync(org, repo, env, "environment")).Count == 0;
        }
        catch (ApiException)
        {
            return false;
        }
    }
}
