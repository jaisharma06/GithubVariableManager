using GithubVariablesManager.Api.Contracts;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Batch "copy to other scopes" orchestration (Phase 6) — replaces what used to be
/// <c>CopyFacade.CopyTo</c>'s client-side <c>Promise.allSettled</c> fan-out over
/// <c>ItemMutationsFacade</c>'s single-item mutations. Fans out over the caller-supplied target list
/// with <see cref="Task.WhenAll"/> and calls <see cref="ItemMutationService"/>'s existing
/// single-item methods in-process — no GitHub-calling logic is duplicated here, only orchestration.
///
/// Deliberate deviation from the rest of this backend's error handling: every other write here lets
/// <see cref="Octokit.ApiException"/> propagate uncaught, because a single-item mutation failing *is*
/// the whole request failing. A batch is different by definition — one target being locked/forbidden
/// must not fail the other N-1 targets, so each target's <see cref="Octokit.ApiException"/> is caught
/// and reported individually via <see cref="CopyTargetResult"/>. A non-<see cref="Octokit.ApiException"/>
/// (a real bug) still isn't caught here and still 500s via the global
/// <see cref="Auth.PermissionErrorExceptionHandler"/> fallthrough — that's correct, don't broaden the
/// catch.
/// </summary>
public sealed class CopyService(ItemMutationService itemMutationService)
{
    public async Task<IReadOnlyList<CopyTargetResult>> CopyAsync(
        string kind, string name, string value, string? visibility,
        IReadOnlyList<long>? selectedRepositoryIds, IReadOnlyList<LedgerScopeTargetRequest> targets) =>
        await Task.WhenAll(targets.Select(t => CopyOneAsync(kind, name, value, visibility, selectedRepositoryIds, t)));

    private async Task<CopyTargetResult> CopyOneAsync(
        string kind, string name, string value, string? visibility,
        IReadOnlyList<long>? selectedRepositoryIds, LedgerScopeTargetRequest t)
    {
        try
        {
            if (kind == "variable")
            {
                await itemMutationService.UpsertVariableAsync(t.Org, t.Repo, t.Env, t.Level, name, value);
            }
            else
            {
                await itemMutationService.PutSecretAsync(t.Org, t.Repo, t.Env, t.Level, name, value, visibility, selectedRepositoryIds);
            }
            return new CopyTargetResult(new LedgerScopeTargetResponse(t.Org, t.Repo, t.Env, t.Level), true, null);
        }
        catch (Octokit.ApiException ex)
        {
            return new CopyTargetResult(new LedgerScopeTargetResponse(t.Org, t.Repo, t.Env, t.Level), false, ex.Message);
        }
    }
}
