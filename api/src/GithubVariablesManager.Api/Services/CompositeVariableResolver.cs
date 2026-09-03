using System.Text.RegularExpressions;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Thrown by <see cref="ItemMutationService"/>'s pre-write validation when a composite variable's
/// formula would create a circular reference — not an <see cref="Octokit.ApiException"/> (nothing
/// touched GitHub yet), so it's caught locally in <c>Endpoints/LedgerEndpoints.cs</c> and mapped to
/// a 400, mirroring the <see cref="EnvironmentRenameValidationException"/> local-catch precedent.
/// </summary>
public sealed class CompositeCircularReferenceException(string message) : Exception(message);

/// <summary>
/// Thrown by <see cref="ItemMutationService.SyncCompositeVariableAsync"/> when the named variable
/// isn't actually tracked as composite in its scope's manifest (<see cref="CompositeManifestService"/>)
/// — not an <see cref="Octokit.ApiException"/> (nothing touched GitHub), so it's caught locally in
/// <c>Endpoints/LedgerEndpoints.cs</c> and mapped to a 400, the same local-catch pattern this file's
/// <see cref="CompositeCircularReferenceException"/> already established.
/// </summary>
public sealed class CompositeFormulaNotFoundException(string message) : Exception(message);

/// <summary>
/// Result of resolving a single composite formula: the fully-substituted literal (nested composite
/// references are resolved recursively too), which of its <c>$(NAME)</c> tokens couldn't be found
/// anywhere in the supplied lookup (left as literal <c>$(NAME)</c> text in <see cref="ResolvedValue"/>
/// rather than blanked out, so a broken reference is still visible in place), and whether resolving
/// it walked into a cycle. <see cref="ResolvedValue"/> is <see langword="null"/> only when
/// <see cref="Circular"/> is true — a circular formula has no well-defined resolved value.
/// </summary>
public sealed record CompositeResolutionResult(
    string? ResolvedValue,
    IReadOnlyList<string> UnresolvedReferences,
    bool Circular,
    string? CircularError);

/// <summary>
/// Owns every piece of composite-variable logic — a GitHub Actions <b>variable</b> (never a secret,
/// see "Secrets" below) whose value can reference other variables via <c>$(OtherVarName)</c>
/// syntax. Unlike this feature's original design, the stored GitHub value is now always the
/// resolved literal (works immediately in any real Actions workflow run, no manual step) — whether
/// a variable is composite at all is now tracked separately, in each scope's hidden manifest
/// variable (<see cref="CompositeManifestService"/>), not derived from the value's own shape. This
/// class is still the one place formula resolution itself happens (regex-matching
/// <see cref="ReferencePattern"/> against a formula string, recursion-stack cycle detection, and the
/// two lookup builders below) — it just no longer decides "is this composite" on its own; callers
/// (<see cref="LedgerService"/>, <see cref="ItemMutationService"/>) look that up in the manifest
/// first and pass this class the formula text once they already know it's composite. <see cref="IsComposite"/>
/// itself is still used for live-authoring-time detection of what's currently typed into a value box,
/// before anything is saved to a manifest.
///
/// Kept a distinct, narrow service — not folded into <see cref="LedgerService"/> or
/// <see cref="ItemMutationService"/> — the same rationale <see cref="SecretSealingService"/> is kept
/// separate from <see cref="ItemMutationService"/>: composite resolution is a self-contained
/// concern (regex + recursion-stack cycle detection + two different ways of building a name→value
/// lookup) that both a read path (<see cref="LedgerService"/>) and a write path
/// (<see cref="ItemMutationService"/>, <c>Endpoints/LedgerEndpoints.cs</c>'s preview route) need
/// without either owning it.
///
/// Two lookup builders, matching the two places a resolution needs to happen:
/// <list type="bullet">
/// <item><see cref="BuildLookupFromItems"/> — reuses an already-fetched in-memory
/// <see cref="LedgerItemResponse"/> list (no extra GitHub calls), for <see cref="LedgerService"/>'s
/// read-time display-resolution pass.</item>
/// <item><see cref="BuildLookupAsync"/> — fresh, scoped <see cref="ActionsRestClient"/> calls at
/// only the levels relevant to one item's own precedence chain, for the preview/resolve endpoint
/// and for pre-write circular-reference validation, neither of which has a full ledger read handy.</item>
/// </list>
///
/// Scope precedence mirrors GitHub Actions' real override chain exactly — environment > repository
/// > organization — enforced simply by both lookup builders overwriting broader-scope entries with
/// narrower-scope ones of the same name (last write wins), and by only ever including levels that
/// are actually part of the item's own chain (an organization-level composite only ever sees
/// organization-level names; a repository-level composite sees repository+organization; an
/// environment-level composite sees environment+repository+organization). No cross-repo/cross-org
/// reference is possible, since neither builder ever looks outside the single org/repo passed in.
/// </summary>
public sealed class CompositeVariableResolver(ActionsRestClient actionsRestClient)
{
    /// <summary><c>$(NAME)</c> — a GitHub Actions variable name is letters/digits/underscore, must not start with a digit.</summary>
    private static readonly Regex ReferencePattern = new(@"\$\(([A-Za-z_][A-Za-z0-9_]*)\)", RegexOptions.Compiled);

    public static bool IsComposite(string value) => ReferencePattern.IsMatch(value);

    public static IReadOnlyList<string> ExtractReferences(string value) =>
        ReferencePattern.Matches(value).Select(m => m.Groups[1].Value).Distinct().ToList();

    /// <summary>
    /// Resolves <paramref name="value"/> against <paramref name="lookup"/> (name -> raw stored
    /// value, one entry per name visible in the item's own effective scope chain). Nested composite
    /// references are resolved recursively. <paramref name="name"/> is the formula's own variable
    /// name (empty for a not-yet-named context) — seeded as the first frame of the recursion stack
    /// so a direct self-reference (<c>X = $(X)</c>) is caught by the exact same recursion-stack walk
    /// as any longer cycle, rather than needing a separate special case.
    /// </summary>
    public CompositeResolutionResult Resolve(string name, string value, IReadOnlyDictionary<string, string> lookup)
    {
        var unresolved = new List<string>();
        var stack = new List<string>();
        if (!string.IsNullOrEmpty(name)) stack.Add(name);

        try
        {
            var resolved = ResolveRecursive(value, lookup, stack, unresolved);
            return new CompositeResolutionResult(resolved, unresolved.Distinct().ToList(), Circular: false, CircularError: null);
        }
        catch (CompositeCircularReferenceException ex)
        {
            return new CompositeResolutionResult(null, unresolved.Distinct().ToList(), Circular: true, ex.Message);
        }
    }

    private static string ResolveRecursive(string value, IReadOnlyDictionary<string, string> lookup, List<string> stack, List<string> unresolved)
    {
        return ReferencePattern.Replace(value, match =>
        {
            var refName = match.Groups[1].Value;

            if (stack.Contains(refName))
            {
                throw new CompositeCircularReferenceException(
                    $"Circular reference detected: {string.Join(" -> ", stack)} -> {refName}");
            }

            if (!lookup.TryGetValue(refName, out var refValue))
            {
                unresolved.Add(refName);
                return match.Value; // leave the literal $(NAME) token in place — a broken reference stays visible, not blanked
            }

            if (!IsComposite(refValue)) return refValue;

            stack.Add(refName);
            var nested = ResolveRecursive(refValue, lookup, stack, unresolved);
            stack.RemoveAt(stack.Count - 1);
            return nested;
        });
    }

    /// <summary>
    /// Lookup builder (a) — from an already-fetched in-memory ledger read, no extra GitHub calls.
    /// Only variables (not secrets — a composite formula can never reference a secret, see this
    /// class's doc comment) contribute entries. Applies the env > repo > org precedence by adding
    /// broader levels first and letting narrower ones overwrite same-named entries.
    /// </summary>
    public static IReadOnlyDictionary<string, string> BuildLookupFromItems(
        IReadOnlyList<LedgerItemResponse> items, string level, string org, string? repo, string? env)
    {
        var lookup = new Dictionary<string, string>();

        void AddLevel(string targetLevel, string? targetEnv)
        {
            foreach (var item in items)
            {
                if (item.Kind != "variable" || item.Value is null) continue;
                if (item.Level != targetLevel || item.Org != org) continue;
                if (targetLevel != "organization" && item.Repo != repo) continue;
                if (targetLevel == "environment" && item.Env != targetEnv) continue;
                lookup[item.Name] = item.Value;
            }
        }

        AddLevel("organization", null);
        if (level is "repository" or "environment") AddLevel("repository", null);
        if (level == "environment") AddLevel("environment", env);

        return lookup;
    }

    /// <summary>
    /// Lookup builder (b) — fresh, scoped reads via <see cref="ActionsRestClient"/>, only at the
    /// levels relevant to one item's own precedence chain (never the whole ledger). Used by the
    /// preview/resolve endpoint and by <see cref="ItemMutationService"/>'s pre-write validation,
    /// neither of which has an in-memory ledger read available. A locked/forbidden level is treated
    /// as contributing no entries (silently skipped) rather than failing the whole lookup — this
    /// method isn't the place to classify or surface that as an error; the caller's own read (or the
    /// live editing session) already will have.
    /// </summary>
    public async Task<IReadOnlyDictionary<string, string>> BuildLookupAsync(string org, string? repo, string? env, string level)
    {
        var lookup = new Dictionary<string, string>();

        async Task AddLevelAsync(string targetLevel, string? targetRepo, string? targetEnv)
        {
            try
            {
                var raw = await actionsRestClient.ListVariablesAsync(org, targetRepo, targetEnv, targetLevel);
                foreach (var variable in raw)
                {
                    // The manifest variable is never a real sibling to resolve against — unlike
                    // BuildLookupFromItems above, this reads directly via ActionsRestClient rather
                    // than an already-manifest-filtered item list, so it needs its own guard.
                    if (variable.Name == CompositeManifestService.ManifestVariableName) continue;
                    lookup[variable.Name] = variable.Value;
                }
            }
            catch (Octokit.ApiException)
            {
                // No access to this level — contributes nothing, doesn't fail the whole lookup.
            }
        }

        await AddLevelAsync("organization", null, null);
        if (level is "repository" or "environment") await AddLevelAsync("repository", repo, null);
        if (level == "environment") await AddLevelAsync("environment", repo, env);

        return lookup;
    }
}
