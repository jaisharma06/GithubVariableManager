using Octokit;

namespace GithubVariablesManager.Api.GitHub;

/// <summary>
/// Low-level REST wrapper for GitHub Actions Variables/Secrets/Environments — the resources
/// Octokit.NET 14.0.0 has no typed client for (confirmed against Octokit's source and its open
/// feature requests). Talks through the current request's Octokit <see cref="IConnection"/>
/// generic Get/Post/Put/Patch/Delete methods, which still throw <see cref="Octokit.ApiException"/>
/// on any non-2xx response — same as every typed Octokit call elsewhere in this app, so
/// <see cref="Auth.PermissionErrorExceptionHandler"/> still applies uncaught.
///
/// URL-building is a direct port of
/// <c>client/src/app/core/gateways/GithubPathBuilder.ts</c>'s <c>VariablesPath</c>/
/// <c>SecretsPath</c> level-branching; pagination is a direct port of
/// <c>client/src/app/core/gateways/GithubPagination.ts</c>'s <c>Paginate</c> (total-count-driven)
/// loop. Kept as the single place both <see cref="Services.LedgerService"/> (reads) and
/// <see cref="Services.ItemMutationService"/> (writes) go through, so this URL/pagination logic
/// exists in exactly one server-side place.
/// </summary>
public sealed class ActionsRestClient(GitHubClientFactory gitHubClientFactory)
{
    private IConnection Connection => gitHubClientFactory.CreateForCurrentUser().Connection;

    private static string VariablesPath(string org, string? repo, string? env, string level) => level switch
    {
        "organization" => $"orgs/{org}/actions/variables",
        "repository" => $"repos/{org}/{repo}/actions/variables",
        "environment" => $"repos/{org}/{repo}/environments/{Uri.EscapeDataString(env!)}/variables",
        _ => throw new ArgumentOutOfRangeException(nameof(level), level, "Unknown level."),
    };

    private static string SecretsPath(string org, string? repo, string? env, string level) => level switch
    {
        "organization" => $"orgs/{org}/actions/secrets",
        "repository" => $"repos/{org}/{repo}/actions/secrets",
        "environment" => $"repos/{org}/{repo}/environments/{Uri.EscapeDataString(env!)}/secrets",
        _ => throw new ArgumentOutOfRangeException(nameof(level), level, "Unknown level."),
    };

    /// <summary>Direct port of GithubPagination.ts's Paginate: follows GitHub's total-count-driven list responses until every item has been collected.</summary>
    private static async Task<List<TItem>> Paginate<TItem>(Func<int, Task<(int TotalCount, List<TItem> Items)>> fetchPage)
    {
        var all = new List<TItem>();
        var page = 1;
        while (true)
        {
            var (totalCount, items) = await fetchPage(page);
            all.AddRange(items);
            if (items.Count == 0 || all.Count >= totalCount) break;
            page += 1;
        }
        return all;
    }

    // ---- reads ----

    public async Task<IReadOnlyList<RawVariable>> ListVariablesAsync(string org, string? repo, string? env, string level)
    {
        var path = VariablesPath(org, repo, env, level);
        return await Paginate<RawVariable>(async page =>
        {
            var response = await Connection.Get<RawVariableListResponse>(
                new Uri($"{path}?per_page=100&page={page}", UriKind.Relative),
                new Dictionary<string, string>());
            return (response.Body.TotalCount, response.Body.Variables);
        });
    }

    /// <summary>Names/metadata only — GitHub never returns a secret's value, to anyone, at any level.</summary>
    public async Task<IReadOnlyList<RawSecret>> ListSecretsAsync(string org, string? repo, string? env, string level)
    {
        var path = SecretsPath(org, repo, env, level);
        return await Paginate<RawSecret>(async page =>
        {
            var response = await Connection.Get<RawSecretListResponse>(
                new Uri($"{path}?per_page=100&page={page}", UriKind.Relative),
                new Dictionary<string, string>());
            return (response.Body.TotalCount, response.Body.Secrets);
        });
    }

    /// <summary>
    /// Single page only (no pagination loop) — direct port of
    /// <c>GithubEnvironmentsGateway.service.ts</c>'s <c>ListEnvironments</c>, which never
    /// paginated either. The "no environments configured -> GitHub 404" business rule is the
    /// caller's (<see cref="Services.EnvironmentsService"/>'s) concern, not this method's — this
    /// method lets that <see cref="Octokit.ApiException"/> propagate uncaught, same as every other
    /// read here.
    /// </summary>
    public async Task<IReadOnlyList<RawEnvironment>> ListEnvironmentsAsync(string org, string repo)
    {
        var response = await Connection.Get<RawEnvironmentListResponse>(
            new Uri($"repos/{org}/{repo}/environments?per_page=100", UriKind.Relative),
            new Dictionary<string, string>());
        return response.Body.Environments;
    }

    // ---- variable writes ----

    public async Task CreateVariableAsync(string org, string? repo, string? env, string level, string name, string value)
    {
        var path = VariablesPath(org, repo, env, level);
        await Connection.Post<object>(
            new Uri(path, UriKind.Relative),
            new { name, value },
            "application/vnd.github+json",
            "application/json");
    }

    /// <summary>
    /// Create-or-update-by-name, no rename — GETs the variable by name first to decide; a 404
    /// means create, anything else means update-in-place (same name). Used only by
    /// <see cref="Services.ItemMutationService.UpsertVariableAsync"/> (CopyFacade's variable
    /// branch), kept distinct from <see cref="CreateVariableAsync"/> so the plain Add flow keeps
    /// GitHub's own "already exists" error intact instead of silently overwriting a duplicate name.
    /// </summary>
    public async Task UpsertVariableAsync(string org, string? repo, string? env, string level, string name, string value)
    {
        var exists = await GetVariableAsync(org, repo, env, level, name) is not null;
        if (exists)
        {
            await UpdateVariableAsync(org, repo, env, level, name, name, value);
        }
        else
        {
            await CreateVariableAsync(org, repo, env, level, name, value);
        }
    }

    /// <summary>Rename+value-update in one PATCH call — matches GitHub's single-PATCH semantics exactly.</summary>
    public async Task UpdateVariableAsync(string org, string? repo, string? env, string level, string currentName, string newName, string value)
    {
        var path = VariablesPath(org, repo, env, level);
        await Connection.Patch<object>(
            new Uri($"{path}/{Uri.EscapeDataString(currentName)}", UriKind.Relative),
            new { name = newName, value });
    }

    public async Task DeleteVariableAsync(string org, string? repo, string? env, string level, string name)
    {
        var path = VariablesPath(org, repo, env, level);
        await Connection.Delete(new Uri($"{path}/{Uri.EscapeDataString(name)}", UriKind.Relative));
    }

    private async Task<RawVariable?> GetVariableAsync(string org, string? repo, string? env, string level, string name)
    {
        var path = VariablesPath(org, repo, env, level);
        try
        {
            var response = await Connection.Get<RawVariable>(
                new Uri($"{path}/{Uri.EscapeDataString(name)}", UriKind.Relative),
                new Dictionary<string, string>());
            return response.Body;
        }
        catch (NotFoundException)
        {
            return null;
        }
    }

    // ---- secret writes ----

    /// <summary>The recipient public key a secret must be sealed against before it's PUT — <see cref="Services.SecretSealingService"/> is the only caller of this key's contents.</summary>
    public async Task<RawPublicKey> GetPublicKeyAsync(string org, string? repo, string? env, string level)
    {
        var path = SecretsPath(org, repo, env, level);
        var response = await Connection.Get<RawPublicKey>(
            new Uri($"{path}/public-key", UriKind.Relative),
            new Dictionary<string, string>());
        return response.Body;
    }

    /// <summary>
    /// Upsert-only, matching GitHub's own secrets PUT semantics (unlike variables, there's no
    /// separate create-vs-update split here). Body shape is a direct port of
    /// <c>client/src/app/core/gateways/GithubSecretsGateway.service.ts</c>'s old <c>PutSecret</c>:
    /// visibility fields are org-level-only, defaulting to "all" when omitted, with
    /// <c>selected_repository_ids</c> included only when visibility is "selected".
    /// </summary>
    public async Task PutSecretAsync(string org, string? repo, string? env, string level, string name, string encryptedValue, string keyId, string? visibility, IReadOnlyList<long>? selectedRepositoryIds)
    {
        var path = SecretsPath(org, repo, env, level);
        var body = new Dictionary<string, object>
        {
            ["encrypted_value"] = encryptedValue,
            ["key_id"] = keyId,
        };
        if (level == "organization")
        {
            var resolvedVisibility = visibility ?? "all";
            body["visibility"] = resolvedVisibility;
            if (resolvedVisibility == "selected")
            {
                body["selected_repository_ids"] = selectedRepositoryIds ?? [];
            }
        }

        await Connection.Put<object>(new Uri($"{path}/{Uri.EscapeDataString(name)}", UriKind.Relative), body);
    }

    public async Task DeleteSecretAsync(string org, string? repo, string? env, string level, string name)
    {
        var path = SecretsPath(org, repo, env, level);
        await Connection.Delete(new Uri($"{path}/{Uri.EscapeDataString(name)}", UriKind.Relative));
    }

    // ---- environment writes ----

    /// <summary>
    /// Create-or-update (GitHub's environment PUT has no request body — unlike variables/secrets,
    /// there's nothing to upsert-by-value here, just the environment's existence). Direct port of
    /// <c>client/src/app/core/gateways/GithubEnvironmentsGateway.service.ts</c>'s
    /// <c>CreateEnvironment</c>.
    /// </summary>
    public async Task CreateEnvironmentAsync(string org, string repo, string name) =>
        await Connection.Put<object>(new Uri($"repos/{org}/{repo}/environments/{Uri.EscapeDataString(name)}", UriKind.Relative), new { });

    public async Task DeleteEnvironmentAsync(string org, string repo, string name) =>
        await Connection.Delete(new Uri($"repos/{org}/{repo}/environments/{Uri.EscapeDataString(name)}", UriKind.Relative));
}
