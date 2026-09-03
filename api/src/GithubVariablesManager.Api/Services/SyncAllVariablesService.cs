using GithubVariablesManager.Api.Contracts;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Batch "Sync all composite variables" orchestration — the one global "Sync all" action fans out
/// over a client-computed target list (see <c>Contracts/LedgerContracts.cs</c>'s
/// <see cref="SyncAllVariablesRequest"/> doc comment for why the target list is client-computed, not
/// server-enumerated) and calls <see cref="ItemMutationService.SyncCompositeVariableIfStaleAsync"/>
/// per target in-process — no resolution logic of its own, purely orchestration over what
/// <see cref="ItemMutationService"/>/<see cref="CompositeManifestService"/>/<see cref="CompositeVariableResolver"/>
/// already provide, same SRP split rationale as <see cref="CompositeManifestService"/> itself and
/// the same "thin orchestration Service over existing single-item primitives" shape as
/// <see cref="CopyService"/>/<see cref="DeleteEverywhereService"/>.
///
/// One deliberate structural deviation from <see cref="CopyService"/>/<see cref="DeleteEverywhereService"/>'s
/// precedent: those two only catch <see cref="Octokit.ApiException"/> per-target. This also catches
/// <see cref="CompositeCircularReferenceException"/> and <see cref="CompositeFormulaNotFoundException"/>
/// per-target, since — unlike Copy/Delete-everywhere, where every target is the same simple write —
/// those two domain exceptions are expected, routine outcomes here (one bad formula among many
/// targets: a formula that went circular after a sibling changed, or a target whose manifest entry
/// no longer exists), not something that should abort the whole batch.
/// </summary>
public sealed class SyncAllVariablesService(ItemMutationService itemMutationService)
{
    public async Task<IReadOnlyList<SyncAllTargetResult>> SyncAllAsync(IReadOnlyList<SyncVariableRequest> targets) =>
        await Task.WhenAll(targets.Select(SyncOneAsync));

    private async Task<SyncAllTargetResult> SyncOneAsync(SyncVariableRequest t)
    {
        try
        {
            var (synced, resolvedValue) = await itemMutationService.SyncCompositeVariableIfStaleAsync(t.Org, t.Repo, t.Env, t.Level, t.Name);
            return new SyncAllTargetResult(t, Ok: true, Synced: synced, ResolvedValue: resolvedValue, Message: null);
        }
        catch (CompositeFormulaNotFoundException ex)
        {
            return new SyncAllTargetResult(t, Ok: false, Synced: false, ResolvedValue: null, Message: ex.Message);
        }
        catch (CompositeCircularReferenceException ex)
        {
            return new SyncAllTargetResult(t, Ok: false, Synced: false, ResolvedValue: null, Message: ex.Message);
        }
        catch (Octokit.ApiException ex)
        {
            return new SyncAllTargetResult(t, Ok: false, Synced: false, ResolvedValue: null, Message: ex.Message);
        }
    }
}
