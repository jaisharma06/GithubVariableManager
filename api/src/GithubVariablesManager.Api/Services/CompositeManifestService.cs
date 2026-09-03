using System.Text.Json;
using GithubVariablesManager.Api.GitHub;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Owns reading and writing the one hidden JSON "manifest" variable each scope (organization/each
/// repository/each environment) uses to track which of its variables are composite formulas — the
/// new-model replacement for the old "is composite" == "value looks like a formula" derivation.
/// GitHub itself still stores every variable's real, resolved literal; this manifest is the only
/// place a variable's original <c>$(NAME)</c> formula text survives, so a variable's real value can
/// always be a working literal immediately, with the formula recoverable on demand via Sync.
///
/// Kept SRP-separate from <see cref="CompositeVariableResolver"/> — that class resolves a formula
/// against a name->value lookup; this class owns the manifest blob's read/write mechanics only, the
/// same narrow-service split this backend already applies elsewhere (e.g.
/// <see cref="SecretSealingService"/> kept separate from <see cref="ItemMutationService"/>).
///
/// Talks to <see cref="ActionsRestClient"/> directly rather than going through
/// <see cref="ItemMutationService"/> — <see cref="ItemMutationService"/> is this service's own
/// consumer, so routing writes back through it would be a circular dependency.
/// </summary>
public sealed class CompositeManifestService(ActionsRestClient actionsRestClient)
{
    /// <summary>
    /// Matches GitHub Actions' variable name pattern (<c>^[A-Za-z_][A-Za-z0-9_]*$</c>), doesn't
    /// start with the reserved <c>GITHUB_</c> prefix, and reads as internal/reserved so it's never
    /// mistaken for a variable a user created themselves.
    /// </summary>
    public const string ManifestVariableName = "__GHVM_COMPOSITE_MANIFEST__";

    private static readonly IReadOnlyDictionary<string, string> EmptyManifest = new Dictionary<string, string>();

    /// <summary>
    /// Parses the manifest map out of an already-fetched <see cref="ActionsRestClient.ListVariablesAsync"/>
    /// result — no GitHub call of its own. Used by <see cref="LedgerService"/>'s read path, which
    /// already fetches this exact list for every scope job; keeping the parse here (rather than
    /// duplicating it) is what lets that read path stay a "no new GitHub calls" change.
    /// Missing or unparseable manifest content degrades to an empty map — this is also how a
    /// pre-existing old-model row (a plain <c>$(...)</c>-literal value with no manifest entry) reads
    /// as an ordinary plain variable now, with no special migration needed.
    /// </summary>
    public static IReadOnlyDictionary<string, string> ParseManifest(IReadOnlyList<RawVariable> rawVariables)
    {
        var manifestVariable = rawVariables.FirstOrDefault(v => v.Name == ManifestVariableName);
        if (manifestVariable is null) return EmptyManifest;
        return ParseJson(manifestVariable.Value);
    }

    /// <summary>Fresh read via <see cref="ActionsRestClient"/> — for write-path callers that don't already have this scope's variable list in hand.</summary>
    public async Task<IReadOnlyDictionary<string, string>> GetManifestAsync(string org, string? repo, string? env, string level)
    {
        var raw = await actionsRestClient.ListVariablesAsync(org, repo, env, level);
        return ParseManifest(raw);
    }

    /// <summary>
    /// The only write primitive: reads the current manifest as a mutable dictionary, runs
    /// <paramref name="mutate"/> against it, and issues a GitHub write only if the map actually
    /// changed as a result — an unnecessary write (e.g. removing a key that was never present) is a
    /// deliberate no-op, not a wasted API call.
    /// </summary>
    public async Task ApplyAsync(string org, string? repo, string? env, string level, Action<Dictionary<string, string>> mutate)
    {
        var current = new Dictionary<string, string>(await GetManifestAsync(org, repo, env, level));
        var original = new Dictionary<string, string>(current);

        mutate(current);

        if (MapsEqual(original, current)) return;

        var json = JsonSerializer.Serialize(current);
        await actionsRestClient.UpsertVariableAsync(org, repo, env, level, ManifestVariableName, json);
    }

    private static IReadOnlyDictionary<string, string> ParseJson(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? EmptyManifest;
        }
        catch (JsonException)
        {
            return EmptyManifest;
        }
    }

    private static bool MapsEqual(Dictionary<string, string> a, Dictionary<string, string> b) =>
        a.Count == b.Count && a.All(kv => b.TryGetValue(kv.Key, out var value) && value == kv.Value);
}
