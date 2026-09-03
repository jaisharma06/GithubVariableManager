namespace GithubVariablesManager.Api.Contracts;

// Level/Kind stay plain strings deliberately (not C# enums) — a C# enum would default to
// PascalCase on the wire, breaking parity with client/'s TS string unions without extra converter
// config.

public sealed record LedgerItemResponse(
    string Kind,              // "variable" | "secret"
    string Level,              // "organization" | "repository" | "environment"
    string Org,
    string? Repo,
    string? Env,
    string Name,
    string? Value,             // present only for variables; always null for secrets (write-only constraint). For a composite variable this is the real, already-resolved GitHub literal as of its last create/update/sync — never the raw formula.
    string? Visibility,        // secrets only, org-level ("all" | "private" | "selected") — populated for org-level secrets from GitHub's read response; unaffected by write orchestration
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    // Composite-variable manifest fields (Services/CompositeManifestService.cs /
    // Services/CompositeVariableResolver.cs), populated by LedgerService's post-fan-out pass only
    // when the item's name is a key in its own scope's manifest — null for every plain
    // (non-composite) item and for every secret.
    // Formula: the raw $(NAME) formula text as saved in the manifest — the source of "what to show/
    // edit as the formula" now; Value no longer serves that role.
    // ResolvedValue: recomputed fresh on every read against CURRENT sibling values (never cached) —
    // repurposed as a staleness signal. ResolvedValue != Value means a dependency changed since this
    // item's last sync, surfaced in the UI as "stale — click Sync". Null when the formula is
    // currently circular.
    string? Formula = null,
    string? ResolvedValue = null,
    IReadOnlyList<string>? UnresolvedReferences = null);

public sealed record LedgerPartialErrorResponse(string Label, string Message);
public sealed record LedgerLockedSectionResponse(string Level, string Kind, string ScopeLabel, string? Env);

public sealed record LedgerResponse(
    IReadOnlyList<LedgerItemResponse> Items,
    IReadOnlyList<LedgerPartialErrorResponse> PartialErrors,
    IReadOnlyList<LedgerLockedSectionResponse> LockedSections);

public sealed record CreateVariableRequest(string Org, string? Repo, string? Env, string Level, string Name, string Value);
public sealed record RenameVariableRequest(string Org, string? Repo, string? Env, string Level, string CurrentName, string NewName, string Value);

/// <summary>
/// Returned by <c>POST</c>/<c>PATCH /api/ledger/variables</c> — mirrors the existing
/// <see cref="RenameSecretResponse"/> outcome-reporting precedent. The variable write itself always
/// succeeds by the time this is returned (a failure there throws/propagates as usual); this only
/// reports whether the best-effort manifest update that follows it (see
/// <see cref="Services.CompositeManifestService"/>) also succeeded. For the overwhelming majority of
/// writes (plain, non-composite values with no prior formula) this is always <c>(true, null)</c>.
/// </summary>
public sealed record UpsertVariableResponse(bool ManifestSynced, string? ManifestSyncError);

/// <summary>
/// Request for <c>POST /api/ledger/variables/sync</c> — re-reads a variable's formula from its
/// scope's manifest and recomputes it against current sibling values, overwriting the real GitHub
/// value in place. Deliberately carries no formula/value of its own — the server looks its formula
/// up from the manifest it already owns, rather than trusting a client-supplied one.
/// </summary>
public sealed record SyncVariableRequest(string Org, string? Repo, string? Env, string Level, string Name);
public sealed record SyncVariableResponse(string ResolvedValue, IReadOnlyList<string> UnresolvedReferences);

/// <summary>
/// Request for <c>POST /api/ledger/variables/sync-all</c> — one global "Sync all" action that
/// re-syncs every composite variable across the currently-open ledger (org + repo + every
/// environment) in one batch call. <c>Targets</c> is client-computed (see
/// <c>client/src/app/core/facades/LedgerSupport.ts</c>'s <c>FindComposites</c>) from the already-
/// fetched ledger data, not re-enumerated server-side from scratch — the client already knows
/// which items are composite from its last <c>GET /api/ledger</c> read. Reuses
/// <see cref="SyncVariableRequest"/> as the per-target shape, same reuse precedent as
/// <see cref="LedgerScopeTargetRequest"/> being shared by <see cref="CopyRequest"/> and
/// <see cref="DeleteEverywhereRequest"/>.
/// </summary>
public sealed record SyncAllVariablesRequest(IReadOnlyList<SyncVariableRequest> Targets);

/// <summary>
/// <see cref="Ok"/>/<see cref="Synced"/> are independent flags: <c>Ok:true,Synced:true</c> means
/// resolved fresh and the value changed, so it was written; <c>Ok:true,Synced:false</c> means
/// resolved fresh but already current, so the write was skipped; <see langword="false"/>
/// <see cref="Ok"/> means a circular formula, a missing manifest entry, or a GitHub API error —
/// <see cref="Message"/> is set in that case.
/// </summary>
public sealed record SyncAllTargetResult(
    SyncVariableRequest Target, bool Ok, bool Synced, string? ResolvedValue, string? Message);

public sealed record SyncAllVariablesResponse(IReadOnlyList<SyncAllTargetResult> Results);

/// <summary>
/// Preview-only request for <c>POST /api/ledger/variables/resolve</c> — never writes anything.
/// <c>Name</c> is the variable's own name (its current name while editing, or the name being typed
/// for a new variable) — seeded as the resolver's own recursion-stack frame so a direct
/// self-reference is caught by the same circular-reference check as any longer cycle. Used by
/// <c>ItemEditorPanelComponent</c> for live authoring feedback as the user types a composite
/// formula: resolved value, which references don't exist yet, and whether the formula is circular.
/// </summary>
public sealed record ResolveVariableRequest(string Org, string? Repo, string? Env, string Level, string Name, string Value);
public sealed record ResolveVariableResponse(string? ResolvedValue, IReadOnlyList<string> UnresolvedReferences, bool Circular, string? CircularError);

public sealed record PutSecretRequest(string Org, string? Repo, string? Env, string Level, string Name, string Value, string? Visibility, IReadOnlyList<long>? SelectedRepositoryIds);
public sealed record RenameSecretRequest(string Org, string? Repo, string? Env, string Level, string CurrentName, string NewName, string Value, string? Visibility, IReadOnlyList<long>? SelectedRepositoryIds);
public sealed record RenameSecretResponse(bool DeleteSucceeded, string? DeleteError);

/// <summary>Mirrors <c>client/src/app/core/Types.ts</c>'s <c>GithubEnvironment</c> shape — wire-exposed directly via <c>GET /api/ledger/environments</c>, same as <c>ScopesService</c>'s Contracts/ types.</summary>
public sealed record EnvironmentResponse(string Name, long Id);

public sealed record CreateEnvironmentRequest(string Org, string Repo, string Name);

/// <summary>
/// GitHub has no rename API for environments — this is create-new, copy every environment-level
/// variable's value across, then conditionally delete-old, done server-side in one call now
/// instead of three sequential client-side mutations. See
/// <see cref="Services.EnvironmentRenameService"/>'s doc comment for the full outcome-reporting
/// design.
/// </summary>
public sealed record RenameEnvironmentRequest(string Org, string Repo, string OldName, string NewName, bool DeleteOldAnyway);

public sealed record VariableCopyFailureResponse(string Name, string Error);

public sealed record RenameEnvironmentResponse(
    string? ListVariablesError,
    int VariablesCopied,
    IReadOnlyList<VariableCopyFailureResponse> VariableCopyFailures,
    bool OldEnvironmentDeleted,
    string? OldEnvironmentDeleteError);

/// <summary>
/// Batch orchestration (Phase 6) — <see cref="Services.CopyService"/>/
/// <see cref="Services.DeleteEverywhereService"/> fan out a single-item mutation over a caller-supplied
/// target list server-side, replacing what used to be N sequential/`Promise.allSettled`-driven client-side
/// calls in `CopyFacade.CopyTo`/`DeleteEverywhereFacade.DeleteFrom`.
/// </summary>
public sealed record LedgerScopeTargetRequest(string Org, string? Repo, string? Env, string Level);
public sealed record LedgerScopeTargetResponse(string Org, string? Repo, string? Env, string Level);

public sealed record CopyRequest(
    string Kind,                                   // "variable" | "secret"
    string Name,
    string Value,
    string? Visibility,                            // secrets only, mirrors PutSecretRequest
    IReadOnlyList<long>? SelectedRepositoryIds,      // secrets only
    IReadOnlyList<LedgerScopeTargetRequest> Targets);

public sealed record CopyTargetResult(LedgerScopeTargetResponse Target, bool Ok, string? Message);
public sealed record CopyResponse(IReadOnlyList<CopyTargetResult> Results);

public sealed record DeleteEverywhereRequest(string Kind, string Name, IReadOnlyList<LedgerScopeTargetRequest> Targets);
public sealed record DeleteEverywhereTargetResult(LedgerScopeTargetResponse Target, bool Ok, string? Message);
public sealed record DeleteEverywhereResponse(IReadOnlyList<DeleteEverywhereTargetResult> Results);

/// <summary>
/// Copy every variable from one environment into another (same repo or cross-repo/cross-org),
/// with a case-sensitive substring replace of the source environment's name -> the destination
/// environment's name inside each value, skipping any name that already exists at the destination.
/// Deliberately its own request/response shape rather than reusing <see cref="CopyRequest"/> — that
/// endpoint is one-item-to-N-targets with always-overwrite semantics, a different shape from this
/// one-environment-to-one-environment, skip-if-exists, N-variable operation. See
/// <see cref="Services.EnvironmentVariableCopyService"/>'s doc comment for the full design.
/// </summary>
public sealed record CopyEnvironmentVariablesRequest(
    string SourceOrg, string SourceRepo, string SourceEnv,
    string DestOrg, string DestRepo, string DestEnv);

public sealed record CopyEnvironmentVariablesResponse(
    string? ListSourceError,
    IReadOnlyList<string> Copied,
    IReadOnlyList<string> Skipped,
    IReadOnlyList<VariableCopyFailureResponse> Failures);
