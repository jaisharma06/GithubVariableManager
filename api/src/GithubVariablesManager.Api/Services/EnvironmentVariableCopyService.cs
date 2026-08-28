using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using Octokit;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Copies every variable from one environment into another — same repo or cross-repo/cross-org,
/// since nothing in <see cref="GitHub.ActionsRestClient"/> is repo-bound (every method already
/// takes org/repo/env independently). A sibling to <see cref="EnvironmentRenameService"/>, not an
/// extension of it or of <see cref="CopyService"/>: <see cref="CopyService"/>'s shape is one
/// item -> N targets with always-overwrite semantics, a different problem from this one
/// environment -> one environment, skip-if-exists, N-variable batch.
///
/// Outcome-reporting philosophy mirrors <see cref="EnvironmentRenameService"/>'s
/// <c>ListVariablesError</c> precedent exactly: listing the source environment's variables is the
/// one step allowed to fail as a soft, reported failure (GitHub 403/404/etc. on that read) rather
/// than a 5xx — the whole operation is otherwise pointless without it, so this returns 200 with
/// <see cref="CopyEnvironmentVariablesResponse.ListSourceError"/> set and empty
/// Copied/Skipped/Failures rather than throwing. Every subsequent per-variable create is isolated
/// (an <see cref="ApiException"/> for one variable is added to <c>Failures</c>, never aborts the
/// batch), the same per-item isolation <see cref="CopyService"/> and
/// <see cref="EnvironmentRenameService"/> already use for their own per-item writes.
///
/// The value transform is a literal, case-sensitive substring replace of the source environment's
/// name with the destination environment's name (<see cref="StringComparison.Ordinal"/>) — no
/// word-boundary/token-aware smarts, by explicit product decision.
/// </summary>
public sealed class EnvironmentVariableCopyService(ActionsRestClient actionsRestClient, ItemMutationService itemMutationService)
{
    public async Task<CopyEnvironmentVariablesResponse> CopyEnvironmentVariablesAsync(
        string sourceOrg, string sourceRepo, string sourceEnv,
        string destOrg, string destRepo, string destEnv)
    {
        IReadOnlyList<RawVariable> sourceVariables;
        try
        {
            sourceVariables = await actionsRestClient.ListVariablesAsync(sourceOrg, sourceRepo, sourceEnv, "environment");
        }
        catch (ApiException ex)
        {
            return new CopyEnvironmentVariablesResponse(ex.Message, [], [], []);
        }

        // Listing the destination is best-effort in the sense that a failure here just means we
        // can't skip-if-exists accurately — but since we can't safely tell what's already there,
        // treat it the same as "nothing exists yet" would be wrong (could clobber). Instead, a
        // failure to list the destination surfaces the same way as a failure to list the source:
        // nothing is safe to do without knowing what's already there.
        IReadOnlyList<RawVariable> destVariables;
        try
        {
            destVariables = await actionsRestClient.ListVariablesAsync(destOrg, destRepo, destEnv, "environment");
        }
        catch (ApiException ex)
        {
            return new CopyEnvironmentVariablesResponse(ex.Message, [], [], []);
        }

        var existingDestNames = destVariables.Select(v => v.Name).ToHashSet(StringComparer.Ordinal);

        var copied = new List<string>();
        var skipped = new List<string>();
        var failures = new List<VariableCopyFailureResponse>();

        foreach (var variable in sourceVariables)
        {
            if (existingDestNames.Contains(variable.Name))
            {
                skipped.Add(variable.Name);
                continue;
            }

            var transformedValue = variable.Value.Replace(sourceEnv, destEnv, StringComparison.Ordinal);
            try
            {
                await itemMutationService.CreateVariableAsync(destOrg, destRepo, destEnv, "environment", variable.Name, transformedValue);
                copied.Add(variable.Name);
            }
            catch (ApiException ex)
            {
                failures.Add(new VariableCopyFailureResponse(variable.Name, ex.Message));
            }
        }

        return new CopyEnvironmentVariablesResponse(null, copied, skipped, failures);
    }
}
