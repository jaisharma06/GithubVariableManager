using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Variable and secret create/update/delete orchestration. Thin wrapper over
/// <see cref="ActionsRestClient"/>: no try/catch for the variable methods and the secret put/delete
/// steps — a locked (403/404) scope or any other GitHub failure surfaces as
/// <see cref="Octokit.ApiException"/>, which propagates to the global
/// <see cref="Auth.PermissionErrorExceptionHandler"/> uncaught, same pattern as every prior phase.
/// <see cref="RenameSecretAsync"/> is the one deliberate exception — see its own doc comment.
///
/// <see cref="CreateVariableAsync"/> (strict create — GitHub's own "already exists" error surfaces
/// correctly, used by the plain Add flow) is deliberately kept separate from
/// <see cref="UpsertVariableAsync"/> (create-or-update-by-name, no rename, used only by
/// <c>CopyFacade.CopyTo</c>'s variable branch replacing its old client-side
/// <c>t.exists ? update : create</c> branching) — collapsing them would silently change Add-flow
/// behavior (a pure upsert would silently overwrite a duplicate name instead of correctly
/// erroring), a real regression, not a simplification.
/// </summary>
public sealed class ItemMutationService(ActionsRestClient actionsRestClient, SecretSealingService secretSealingService)
{
    public Task CreateVariableAsync(string org, string? repo, string? env, string level, string name, string value) =>
        actionsRestClient.CreateVariableAsync(org, repo, env, level, name, value);

    public Task UpsertVariableAsync(string org, string? repo, string? env, string level, string name, string value) =>
        actionsRestClient.UpsertVariableAsync(org, repo, env, level, name, value);

    /// <summary>Rename+value-update in one call, matching today's single-PATCH behavior.</summary>
    public Task UpdateVariableAsync(string org, string? repo, string? env, string level, string currentName, string newName, string value) =>
        actionsRestClient.UpdateVariableAsync(org, repo, env, level, currentName, newName, value);

    public Task DeleteVariableAsync(string org, string? repo, string? env, string level, string name) =>
        actionsRestClient.DeleteVariableAsync(org, repo, env, level, name);

    /// <summary>
    /// Fetches the scope's current public key, seals the plaintext against it, then PUTs — GitHub's
    /// secrets PUT is already upsert-only, so there's no separate create/upsert split here the way
    /// variables have.
    /// </summary>
    public async Task PutSecretAsync(string org, string? repo, string? env, string level, string name, string plaintextValue, string? visibility, IReadOnlyList<long>? selectedRepositoryIds)
    {
        var publicKey = await actionsRestClient.GetPublicKeyAsync(org, repo, env, level);
        var encryptedValue = secretSealingService.Seal(plaintextValue, publicKey.Key);
        await actionsRestClient.PutSecretAsync(org, repo, env, level, name, encryptedValue, publicKey.KeyId, visibility, selectedRepositoryIds);
    }

    public Task DeleteSecretAsync(string org, string? repo, string? env, string level, string name) =>
        actionsRestClient.DeleteSecretAsync(org, repo, env, level, name);

    /// <summary>
    /// GitHub has no rename API for secrets — this is really create-under-new-name, then
    /// delete-old, done server-side now instead of as two separate client-side mutation calls.
    ///
    /// If step 1 (PUT new name) fails, nothing changed on GitHub's side — let the
    /// <see cref="Octokit.ApiException"/> propagate uncaught to the global exception handler, same
    /// as every other write here. If step 2 (DELETE old name) fails after step 1 already succeeded,
    /// GitHub genuinely now has both secrets: there's no GitHub API making this transactional, and
    /// no compensating action is actually safer (deleting the just-created new name risks losing the
    /// value on the same kind of call that already failed once). The correct behavior for a
    /// stateless backend is to report exactly what happened — 200 OK with
    /// <see cref="RenameSecretResponse"/>'s <c>DeleteSucceeded: false</c> and GitHub's own error
    /// message, not a 5xx, since a 5xx would make the client wrongly roll back to believing nothing
    /// changed when the new name was in fact created.
    /// </summary>
    public async Task<RenameSecretResponse> RenameSecretAsync(string org, string? repo, string? env, string level,
        string currentName, string newName, string plaintextValue, string? visibility, IReadOnlyList<long>? selectedRepositoryIds)
    {
        await PutSecretAsync(org, repo, env, level, newName, plaintextValue, visibility, selectedRepositoryIds);
        try
        {
            await actionsRestClient.DeleteSecretAsync(org, repo, env, level, currentName);
            return new RenameSecretResponse(DeleteSucceeded: true, DeleteError: null);
        }
        catch (Octokit.ApiException ex)
        {
            return new RenameSecretResponse(DeleteSucceeded: false, DeleteError: ex.Message);
        }
    }
}
