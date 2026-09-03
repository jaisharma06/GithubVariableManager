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
public sealed class ItemMutationService(
    ActionsRestClient actionsRestClient,
    SecretSealingService secretSealingService,
    CompositeVariableResolver compositeVariableResolver,
    CompositeManifestService compositeManifestService)
{
    /// <summary>
    /// Strict create. <paramref name="value"/> is the user's raw formula text if they're authoring a
    /// composite (unchanged client contract) — server-side, this now writes the real GitHub value as
    /// today's resolved <b>literal</b> (a real Actions workflow run sees a working value
    /// immediately, no manual step) and separately tracks the formula in this scope's manifest, so
    /// it can be recovered and re-synced later. The variable write happens first, then the manifest
    /// update is attempted best-effort — see this method body's inline comment for why that order is
    /// deliberate. A circular formula is validated before anything is written (see
    /// <see cref="ResolveForWriteAsync"/>); a forward reference to a not-yet-created variable is
    /// deliberately *not* blocked — allowed to save, left as an unresolved literal token in the
    /// written value, recoverable via Sync once the referenced variable exists (see
    /// <see cref="CompositeVariableResolver"/>'s doc comment for the full design).
    /// </summary>
    public async Task<UpsertVariableResponse> CreateVariableAsync(string org, string? repo, string? env, string level, string name, string value)
    {
        var (valueToWrite, isComposite) = await ResolveForWriteAsync(org, repo, env, level, name, value);

        // Variable write first, manifest second: if the manifest update below fails, the artifact
        // that actually matters — a working, correct literal — already exists. The app merely
        // "forgets" it was a formula, recoverable by re-saving. The reverse order would risk an
        // orphaned manifest entry claiming composite-ness for a variable that was never actually
        // written.
        await actionsRestClient.CreateVariableAsync(org, repo, env, level, name, valueToWrite);
        return await SyncManifestEntryAsync(org, repo, env, level, name, isComposite ? value : null);
    }

    /// <summary>
    /// Create-or-update-by-name, no rename — deliberately manifest-unaware. Used only by
    /// <see cref="CopyService"/> (Copy-to-scopes' variable branch) and
    /// <see cref="EnvironmentRenameService"/>, both of which copy a variable's already-resolved
    /// literal value verbatim; a composite formula copying into a scope that's merely missing one of
    /// its referenced names is an explicitly allowed, non-error outcome, and the destination
    /// deliberately does NOT get an auto-created manifest entry — see
    /// <see cref="CompositeVariableResolver"/>'s doc comment for the full design. Unchanged from
    /// before this feature's manifest redesign.
    /// </summary>
    public Task UpsertVariableAsync(string org, string? repo, string? env, string level, string name, string value) =>
        actionsRestClient.UpsertVariableAsync(org, repo, env, level, name, value);

    /// <summary>
    /// Rename+value-update in one call, matching today's single-PATCH behavior. Same resolve-then-
    /// write-then-manifest shape as <see cref="CreateVariableAsync"/>. When the name itself changes,
    /// the manifest update's single <c>ApplyAsync</c> mutate lambda both removes the old-name key and
    /// sets/removes the new-name key — one manifest round trip total regardless of the transition
    /// (composite -> composite-renamed, composite -> plain, plain -> composite).
    /// </summary>
    public async Task<UpsertVariableResponse> UpdateVariableAsync(string org, string? repo, string? env, string level, string currentName, string newName, string value)
    {
        var (valueToWrite, isComposite) = await ResolveForWriteAsync(org, repo, env, level, newName, value);

        await actionsRestClient.UpdateVariableAsync(org, repo, env, level, currentName, newName, valueToWrite);

        var oldNameToRemove = currentName != newName ? currentName : null;
        return await SyncManifestEntryAsync(org, repo, env, level, newName, isComposite ? value : null, oldNameToRemove);
    }

    /// <summary>
    /// Shared pre-write step for <see cref="CreateVariableAsync"/>/<see cref="UpdateVariableAsync"/>:
    /// decides whether <paramref name="value"/> is a composite formula, and if so, resolves it
    /// against the item's current scope chain (throwing <see cref="CompositeCircularReferenceException"/>
    /// on a genuine cycle) to produce the literal that's actually written to GitHub. A plain
    /// (non-composite) value skips the extra GitHub reads entirely and is written unchanged.
    /// </summary>
    private async Task<(string ValueToWrite, bool IsComposite)> ResolveForWriteAsync(string org, string? repo, string? env, string level, string name, string value)
    {
        if (!CompositeVariableResolver.IsComposite(value)) return (value, false);

        var lookup = await compositeVariableResolver.BuildLookupAsync(org, repo, env, level);
        var result = compositeVariableResolver.Resolve(name, value, lookup);
        if (result.Circular)
        {
            throw new CompositeCircularReferenceException(result.CircularError ?? "Circular reference detected.");
        }

        return (result.ResolvedValue!, true);
    }

    /// <summary>
    /// Best-effort manifest write following a successful variable create/rename: composite ->
    /// <c>map[name] = formula</c>; not composite -> <c>map.Remove(name)</c> (covers "was composite,
    /// now plain"). Optionally also removes <paramref name="oldNameToRemove"/> in the same mutate
    /// pass (the rename case). Catches <see cref="Octokit.ApiException"/> from this step specifically
    /// — the variable write already succeeded and is the artifact that matters functionally, so a
    /// manifest failure is reported back rather than failing the whole call.
    /// </summary>
    private async Task<UpsertVariableResponse> SyncManifestEntryAsync(
        string org, string? repo, string? env, string level, string name, string? formulaOrNull, string? oldNameToRemove = null)
    {
        try
        {
            await compositeManifestService.ApplyAsync(org, repo, env, level, map =>
            {
                if (oldNameToRemove is not null) map.Remove(oldNameToRemove);
                if (formulaOrNull is not null) map[name] = formulaOrNull;
                else map.Remove(name);
            });
            return new UpsertVariableResponse(ManifestSynced: true, ManifestSyncError: null);
        }
        catch (Octokit.ApiException ex)
        {
            return new UpsertVariableResponse(ManifestSynced: false, ManifestSyncError: ex.Message);
        }
    }

    public async Task DeleteVariableAsync(string org, string? repo, string? env, string level, string name)
    {
        await actionsRestClient.DeleteVariableAsync(org, repo, env, level, name);

        // Best-effort, silent: the worst case is one inert dead JSON key that ResolveComposites
        // never visits (it only iterates items that still exist) — lower stakes than a
        // create/update manifest failure, which loses live formula-awareness for a variable that
        // still exists.
        try
        {
            await compositeManifestService.ApplyAsync(org, repo, env, level, map => map.Remove(name));
        }
        catch (Octokit.ApiException)
        {
        }
    }

    /// <summary>
    /// Re-reads <paramref name="name"/>'s formula from its scope's manifest, recomputes it against
    /// current sibling values, and overwrites the real GitHub value in place — the manual recovery
    /// action a user takes after a dependency's value changed (surfaced via a stale
    /// <c>ResolvedValue != Value</c> read) or to retry a currently-broken/circular formula. The
    /// manifest itself is untouched — the formula hasn't changed, only its resolved output.
    /// </summary>
    public async Task<SyncVariableResponse> SyncCompositeVariableAsync(string org, string? repo, string? env, string level, string name)
    {
        var (_, result) = await ResolveFromManifestAsync(org, repo, env, level, name);

        await actionsRestClient.UpdateVariableAsync(org, repo, env, level, name, name, result.ResolvedValue!);
        return new SyncVariableResponse(result.ResolvedValue!, result.UnresolvedReferences);
    }

    /// <summary>
    /// The "Sync all" batch action's per-item primitive (<see cref="SyncAllVariablesService"/>) —
    /// same re-read-formula/recompute/overwrite shape as <see cref="SyncCompositeVariableAsync"/>
    /// above, kept as its own method rather than an optional parameter on that one because the two
    /// have genuinely different write contracts: a user explicitly clicking Sync on one row must
    /// still write even when the value is already current (that's <see cref="SyncCompositeVariableAsync"/>'s
    /// existing, unconditional-write behavior — left untouched), while a global batch sync should
    /// skip writing to every already-current item rather than issuing N no-op writes. Skipping the
    /// write costs nothing extra — <paramref name="name"/>'s current value is read for free as part
    /// of <see cref="CompositeVariableResolver.BuildLookupAsync"/>'s own scope-chain lookup, which
    /// already includes this scope's own variables (including this one).
    /// </summary>
    public async Task<(bool Synced, string ResolvedValue)> SyncCompositeVariableIfStaleAsync(string org, string? repo, string? env, string level, string name)
    {
        var (lookup, result) = await ResolveFromManifestAsync(org, repo, env, level, name);

        lookup.TryGetValue(name, out var currentValue); // free — BuildLookupAsync already fetched this scope's own variables, including this one
        if (currentValue == result.ResolvedValue) return (false, result.ResolvedValue!);

        await actionsRestClient.UpdateVariableAsync(org, repo, env, level, name, name, result.ResolvedValue!);
        return (true, result.ResolvedValue!);
    }

    /// <summary>
    /// Shared manifest-lookup/resolve step behind <see cref="SyncCompositeVariableAsync"/> and
    /// <see cref="SyncCompositeVariableIfStaleAsync"/>: re-reads <paramref name="name"/>'s formula
    /// from its scope's manifest, builds the current sibling-value lookup, and resolves the formula
    /// against it — throwing the same two domain exceptions either caller already documents
    /// (<see cref="CompositeFormulaNotFoundException"/>/<see cref="CompositeCircularReferenceException"/>).
    /// Returns the lookup alongside the result so <see cref="SyncCompositeVariableIfStaleAsync"/> can
    /// read this item's own current value out of it at no extra GitHub-call cost.
    /// </summary>
    private async Task<(IReadOnlyDictionary<string, string> Lookup, CompositeResolutionResult Result)> ResolveFromManifestAsync(
        string org, string? repo, string? env, string level, string name)
    {
        var manifest = await compositeManifestService.GetManifestAsync(org, repo, env, level);
        if (!manifest.TryGetValue(name, out var formula))
        {
            throw new CompositeFormulaNotFoundException($"\"{name}\" has no saved formula to sync.");
        }

        var lookup = await compositeVariableResolver.BuildLookupAsync(org, repo, env, level);
        var result = compositeVariableResolver.Resolve(name, formula, lookup);
        if (result.Circular)
        {
            throw new CompositeCircularReferenceException(result.CircularError ?? "Circular reference detected.");
        }

        return (lookup, result);
    }

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
