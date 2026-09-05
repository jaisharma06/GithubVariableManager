using GithubVariablesManager.Api.Auth;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using Octokit;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Thrown when every single fan-out job in <see cref="LedgerService.GetLedgerAsync"/> failed with
/// a genuine (non-403/404) error and none succeeded — the server-side equivalent of
/// <c>LedgerSupport.RunLedgerJobs</c> throwing when <c>partialErrors.length === jobs.length</c>.
/// Not itself an <see cref="Octokit.ApiException"/> (it's a synthesized aggregate over several
/// independent calls), so it's caught locally in <c>Endpoints/LedgerEndpoints.cs</c> rather than
/// going through the global <see cref="PermissionErrorExceptionHandler"/> — mirroring the
/// <see cref="OAuthRelayException"/> local-catch precedent in <c>Services/DeviceFlowService.cs</c>.
/// </summary>
public sealed class LedgerUnavailableException(string message) : Exception(message);

/// <summary>
/// Assembles the ledger — a direct, deliberate 1:1 server-side port of
/// <c>client/src/app/core/facades/LedgerFacade.ts</c>'s query function and
/// <c>LedgerSupport.ts</c>'s <c>RunLedgerJobs</c>/<c>JobLabel</c> fan-out and classification logic.
/// Org-only scope -> org-level variables+secrets only. Repo scope -> repo-level variables+secrets,
/// plus one variables+secrets job per environment on that repo, plus org-level variables+secrets
/// only if the repo's owning account is verified as an actual Organization.
/// </summary>
public sealed class LedgerService(
    ActionsRestClient actionsRestClient,
    EnvironmentsService environmentsService,
    ScopesService scopesService,
    CompositeVariableResolver compositeVariableResolver)
{
    public async Task<LedgerResponse> GetLedgerAsync(string org, string? repo)
    {
        // Jobs are built up-front, in a fixed order, before any of them run concurrently — the
        // account-type check and the environment list are both awaited sequentially here first,
        // so the concurrent job list itself is deterministic.
        var orgLevelApplies = await OrgLevelAppliesAsync(org, repo);
        var jobs = new List<LedgerJob>();

        if (orgLevelApplies)
        {
            jobs.Add(VariablesJob("organization", org, org, null, null));
            jobs.Add(SecretsJob("organization", org, org, null, null));
        }

        if (!string.IsNullOrEmpty(repo))
        {
            jobs.Add(VariablesJob("repository", repo, org, repo, null));
            jobs.Add(SecretsJob("repository", repo, org, repo, null));

            var environments = await environmentsService.ListEnvironmentsAsync(org, repo);
            foreach (var env in environments)
            {
                jobs.Add(VariablesJob("environment", env.Name, org, repo, env.Name));
                jobs.Add(SecretsJob("environment", env.Name, org, repo, env.Name));
            }
        }

        var results = await Task.WhenAll(jobs.Select(RunJobAsync));

        var items = new List<LedgerItemResponse>();
        var partialErrors = new List<LedgerPartialErrorResponse>();
        var lockedSections = new List<LedgerLockedSectionResponse>();
        var corruptedManifestScopes = new List<CorruptedManifestScopeResponse>();
        var manifestsByScope = new Dictionary<ScopeKey, IReadOnlyDictionary<string, string>>();

        foreach (var result in results)
        {
            if (result.Items is not null) items.AddRange(result.Items);
            else if (result.LockedSection is not null) lockedSections.Add(result.LockedSection);
            else if (result.PartialError is not null) partialErrors.Add(result.PartialError);

            if (result.Manifest is not null)
            {
                manifestsByScope[result.Manifest.Value.Key] = result.Manifest.Value.Manifest;
            }

            if (result.CorruptedManifestScope is not null)
            {
                corruptedManifestScopes.Add(result.CorruptedManifestScope);
            }
        }

        // Direct port of RunLedgerJobs' all-failed guard: only throws when *every* job hit a
        // genuine (non-403/404) error — a ledger that's entirely "locked" sections still renders
        // normally, since a locked section is a legitimate, expected state, not a failure.
        if (items.Count == 0 && partialErrors.Count > 0 && partialErrors.Count == jobs.Count)
        {
            throw new LedgerUnavailableException(string.Join("; ", partialErrors.Select(e => $"{e.Label} — {e.Message}")));
        }

        return new LedgerResponse(ResolveComposites(items, manifestsByScope), partialErrors, lockedSections, corruptedManifestScopes);
    }

    /// <summary>
    /// Read-time display resolution (automatic, default — see docs/Architecture.md's composite-
    /// variables section): every composite variable in this response is resolved fresh against the
    /// other variables already fetched in this same request, no extra GitHub calls. Recomputed on
    /// every load, so there's nothing to keep "live" between reads. Manifest-driven now, not
    /// value-pattern-driven: presence of an item's name as a key in its own scope's manifest is the
    /// ONLY thing that makes it composite — <see cref="LedgerItemResponse.Value"/> (the real,
    /// already-resolved GitHub literal) is never consulted for this anymore, only used as the
    /// resolver's fallback lookup content for sibling references. Non-composite items and every
    /// secret pass through unchanged (their trailing Formula/ResolvedValue/UnresolvedReferences stay
    /// null).
    /// </summary>
    private List<LedgerItemResponse> ResolveComposites(
        List<LedgerItemResponse> items, IReadOnlyDictionary<ScopeKey, IReadOnlyDictionary<string, string>> manifestsByScope)
    {
        return items
            .Select(item =>
            {
                if (item.Kind != "variable") return item;

                var scopeKey = new ScopeKey(item.Level, item.Org, item.Repo, item.Env);
                if (!manifestsByScope.TryGetValue(scopeKey, out var manifest) || !manifest.TryGetValue(item.Name, out var formula))
                {
                    return item;
                }

                var lookup = CompositeVariableResolver.BuildLookupFromItems(items, item.Level, item.Org, item.Repo, item.Env);
                var result = compositeVariableResolver.Resolve(item.Name, formula, lookup);
                return item with { Formula = formula, ResolvedValue = result.ResolvedValue, UnresolvedReferences = result.UnresolvedReferences };
            })
            .ToList();
    }

    /// <summary>Keys a scope's manifest map — one manifest per organization/repository/environment level, matching <see cref="CompositeVariableResolver"/>'s own scope-chain shape.</summary>
    private sealed record ScopeKey(string Level, string Org, string? Repo, string? Env);

    /// <summary>
    /// Org-only scopes are always real orgs (enforced by the scope picker upstream); repo scopes
    /// need the account-type check. Any failure of that check (403/404, rate limit, anything)
    /// silently means "treat as not-an-org" — same silent-skip-on-failure behavior as today's
    /// Angular <c>IsOrgAccountQuery</c> (whose <c>orgLevelApplies</c> only turns true on a
    /// confirmed <c>Organization</c> result; an errored query just leaves it false). Deliberately
    /// preserved as-is, not "fixed".
    /// </summary>
    private async Task<bool> OrgLevelAppliesAsync(string org, string? repo)
    {
        if (string.IsNullOrEmpty(repo)) return true;
        try
        {
            var accountType = await scopesService.GetAccountTypeAsync(org);
            return accountType.Type == "Organization";
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// The manifest variable rides along in this same <c>ListVariablesAsync</c> call every scope's
    /// variables job already makes — no extra GitHub call to learn which names in this scope are
    /// composite. Filtered out of the returned item list (it's never a normal row) and parsed
    /// alongside via <see cref="CompositeManifestService.ParseManifest"/>.
    /// </summary>
    private LedgerJob VariablesJob(string level, string scopeLabel, string org, string? repo, string? env) => new(
        level, "variable", scopeLabel, env,
        async () =>
        {
            var raw = await actionsRestClient.ListVariablesAsync(org, repo, env, level);
            var parseResult = CompositeManifestService.ParseManifest(raw);
            var items = raw
                .Where(v => v.Name != CompositeManifestService.ManifestVariableName)
                .Select(v => new LedgerItemResponse(
                    "variable", level, org, repo, env, v.Name, v.Value, null, v.CreatedAt, v.UpdatedAt))
                .ToList();
            var corruptedScope = parseResult.Corrupted ? new CorruptedManifestScopeResponse(level, scopeLabel, env) : null;
            return new JobRunResult(items, (new ScopeKey(level, org, repo, env), parseResult.Manifest), corruptedScope);
        });

    private LedgerJob SecretsJob(string level, string scopeLabel, string org, string? repo, string? env) => new(
        level, "secret", scopeLabel, env,
        async () =>
        {
            var raw = await actionsRestClient.ListSecretsAsync(org, repo, env, level);
            var items = raw.Select(s => new LedgerItemResponse(
                "secret", level, org, repo, env, s.Name, null, s.Visibility, s.CreatedAt, s.UpdatedAt)).ToList();
            return new JobRunResult(items, null, null);
        });

    private static string JobLabel(LedgerJob job)
    {
        var kindLabel = job.Kind == "variable" ? "variables" : "secrets";
        return job.Level switch
        {
            "organization" => $"organization {kindLabel}",
            "repository" => $"repository {kindLabel}",
            _ => $"environment \"{job.Env}\" {kindLabel}",
        };
    }

    private async Task<JobResult> RunJobAsync(LedgerJob job)
    {
        try
        {
            var result = await job.Run();
            return new JobResult(result.Items, null, null, result.Manifest, result.CorruptedManifestScope);
        }
        catch (ApiException ex)
        {
            var classification = PermissionErrorClassifier.Classify((int)ex.StatusCode, ex.Message);
            return classification.Locked
                ? new JobResult(null, new LedgerLockedSectionResponse(job.Level, job.Kind, job.ScopeLabel, job.Env), null, null, null)
                : new JobResult(null, null, new LedgerPartialErrorResponse(JobLabel(job), ex.Message), null, null);
        }
    }

    private sealed record LedgerJob(string Level, string Kind, string ScopeLabel, string? Env, Func<Task<JobRunResult>> Run);

    private sealed record JobRunResult(
        List<LedgerItemResponse> Items,
        (ScopeKey Key, IReadOnlyDictionary<string, string> Manifest)? Manifest,
        CorruptedManifestScopeResponse? CorruptedManifestScope);

    private sealed record JobResult(
        List<LedgerItemResponse>? Items,
        LedgerLockedSectionResponse? LockedSection,
        LedgerPartialErrorResponse? PartialError,
        (ScopeKey Key, IReadOnlyDictionary<string, string> Manifest)? Manifest,
        CorruptedManifestScopeResponse? CorruptedManifestScope);
}
