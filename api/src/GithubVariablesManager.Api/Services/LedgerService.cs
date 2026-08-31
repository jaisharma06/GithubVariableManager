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

        foreach (var result in results)
        {
            if (result.Items is not null) items.AddRange(result.Items);
            else if (result.LockedSection is not null) lockedSections.Add(result.LockedSection);
            else if (result.PartialError is not null) partialErrors.Add(result.PartialError);
        }

        // Direct port of RunLedgerJobs' all-failed guard: only throws when *every* job hit a
        // genuine (non-403/404) error — a ledger that's entirely "locked" sections still renders
        // normally, since a locked section is a legitimate, expected state, not a failure.
        if (items.Count == 0 && partialErrors.Count > 0 && partialErrors.Count == jobs.Count)
        {
            throw new LedgerUnavailableException(string.Join("; ", partialErrors.Select(e => $"{e.Label} — {e.Message}")));
        }

        return new LedgerResponse(ResolveComposites(items), partialErrors, lockedSections);
    }

    /// <summary>
    /// Read-time display resolution (automatic, default — see docs/Architecture.md's composite-
    /// variables section): every composite variable in this response is resolved fresh against the
    /// other variables already fetched in this same request, no extra GitHub calls. Recomputed on
    /// every load, so there's nothing to keep "live" between reads. Non-composite items and every
    /// secret pass through unchanged (their trailing ResolvedValue/UnresolvedReferences stay null).
    /// </summary>
    private List<LedgerItemResponse> ResolveComposites(List<LedgerItemResponse> items)
    {
        return items
            .Select(item =>
            {
                if (item.Kind != "variable" || item.Value is null || !CompositeVariableResolver.IsComposite(item.Value))
                {
                    return item;
                }

                var lookup = CompositeVariableResolver.BuildLookupFromItems(items, item.Level, item.Org, item.Repo, item.Env);
                var result = compositeVariableResolver.Resolve(item.Name, item.Value, lookup);
                return item with { ResolvedValue = result.ResolvedValue, UnresolvedReferences = result.UnresolvedReferences };
            })
            .ToList();
    }

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

    private LedgerJob VariablesJob(string level, string scopeLabel, string org, string? repo, string? env) => new(
        level, "variable", scopeLabel, env,
        async () =>
        {
            var raw = await actionsRestClient.ListVariablesAsync(org, repo, env, level);
            return raw.Select(v => new LedgerItemResponse(
                "variable", level, org, repo, env, v.Name, v.Value, null, v.CreatedAt, v.UpdatedAt)).ToList();
        });

    private LedgerJob SecretsJob(string level, string scopeLabel, string org, string? repo, string? env) => new(
        level, "secret", scopeLabel, env,
        async () =>
        {
            var raw = await actionsRestClient.ListSecretsAsync(org, repo, env, level);
            return raw.Select(s => new LedgerItemResponse(
                "secret", level, org, repo, env, s.Name, null, s.Visibility, s.CreatedAt, s.UpdatedAt)).ToList();
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
            var items = await job.Run();
            return new JobResult(items, null, null);
        }
        catch (ApiException ex)
        {
            var classification = PermissionErrorClassifier.Classify((int)ex.StatusCode, ex.Message);
            return classification.Locked
                ? new JobResult(null, new LedgerLockedSectionResponse(job.Level, job.Kind, job.ScopeLabel, job.Env), null)
                : new JobResult(null, null, new LedgerPartialErrorResponse(JobLabel(job), ex.Message));
        }
    }

    private sealed record LedgerJob(string Level, string Kind, string ScopeLabel, string? Env, Func<Task<List<LedgerItemResponse>>> Run);

    private sealed record JobResult(List<LedgerItemResponse>? Items, LedgerLockedSectionResponse? LockedSection, LedgerPartialErrorResponse? PartialError);
}
