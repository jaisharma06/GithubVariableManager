using GithubVariablesManager.Api.Contracts;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Batch "delete from every scope" orchestration (Phase 6) — replaces what used to be
/// <c>DeleteEverywhereFacade.DeleteFrom</c>'s client-side <c>Promise.allSettled</c> fan-out over
/// <c>ItemMutationsFacade</c>'s single-item mutations. Fans out over the caller-supplied target list
/// with <see cref="Task.WhenAll"/> and calls <see cref="ItemMutationService"/>'s existing
/// single-item delete methods in-process — no GitHub-calling logic is duplicated here, only
/// orchestration.
///
/// Deliberate deviation from the rest of this backend's error handling: every other write here lets
/// <see cref="Octokit.ApiException"/> propagate uncaught, because a single-item mutation failing *is*
/// the whole request failing. A batch is different by definition — one target being locked/forbidden
/// must not fail the other N-1 targets, so each target's <see cref="Octokit.ApiException"/> is caught
/// and reported individually via <see cref="DeleteEverywhereTargetResult"/>. A non-<see
/// cref="Octokit.ApiException"/> (a real bug) still isn't caught here and still 500s via the global
/// <see cref="Auth.PermissionErrorExceptionHandler"/> fallthrough — that's correct, don't broaden the
/// catch.
/// </summary>
public sealed class DeleteEverywhereService(ItemMutationService itemMutationService)
{
    public async Task<IReadOnlyList<DeleteEverywhereTargetResult>> DeleteAsync(
        string kind, string name, IReadOnlyList<LedgerScopeTargetRequest> targets) =>
        await Task.WhenAll(targets.Select(t => DeleteOneAsync(kind, name, t)));

    private async Task<DeleteEverywhereTargetResult> DeleteOneAsync(string kind, string name, LedgerScopeTargetRequest t)
    {
        try
        {
            if (kind == "variable")
            {
                await itemMutationService.DeleteVariableAsync(t.Org, t.Repo, t.Env, t.Level, name);
            }
            else
            {
                await itemMutationService.DeleteSecretAsync(t.Org, t.Repo, t.Env, t.Level, name);
            }
            return new DeleteEverywhereTargetResult(new LedgerScopeTargetResponse(t.Org, t.Repo, t.Env, t.Level), true, null);
        }
        catch (Octokit.ApiException ex)
        {
            return new DeleteEverywhereTargetResult(new LedgerScopeTargetResponse(t.Org, t.Repo, t.Env, t.Level), false, ex.Message);
        }
    }
}
