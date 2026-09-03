import { Injectable, inject } from '@angular/core';
import { injectMutation, injectQueryClient, type QueryKey } from '@tanstack/angular-query-experimental';
import { VARIABLES_GATEWAY, type IVariablesGateway } from '../gateways/IVariablesGateway';
import { SECRETS_GATEWAY, type ISecretsGateway } from '../gateways/ISecretsGateway';
import type { PutSecretOptions } from '../gateways/ISecretsGateway';
import { ItemId } from '../gateways/GithubPathBuilder';
import type { ItemLevel, LedgerItem, ScopeRef } from '../Types';
import { OptimisticSecret, OptimisticVariable, SameScope, type LedgerResult } from './LedgerSupport';

interface CreateVariableParams {
  scope: ScopeRef;
  level: ItemLevel;
  name: string;
  value: string;
}

interface UpdateVariableParams {
  scope: ScopeRef;
  level: ItemLevel;
  currentName: string;
  newName: string;
  value: string;
}

interface DeleteParams {
  scope: ScopeRef;
  level: ItemLevel;
  name: string;
}

interface SecretMutationParams {
  scope: ScopeRef;
  level: ItemLevel;
  name: string;
  value: string;
  options?: PutSecretOptions;
}

interface RenameSecretParams {
  scope: ScopeRef;
  level: ItemLevel;
  currentName: string;
  newName: string;
  value: string;
  options?: PutSecretOptions;
}

/**
 * Facade over IVariablesGateway/ISecretsGateway's create/update/delete calls — port of
 * useCreateVariable/useUpdateVariable/useDeleteVariable/usePutSecret/useRenameSecret/useDeleteSecret.
 * Every mutation optimistically patches the cached ledger query the same way the original does,
 * via the shared Snapshot/Restore/Update helpers below (ports of hooks.ts's
 * snapshotLedger/restoreLedger/updateLedgerItems).
 */
@Injectable({ providedIn: 'root' })
export class ItemMutationsFacade {
  private readonly variablesGateway = inject<IVariablesGateway>(VARIABLES_GATEWAY);
  private readonly secretsGateway = inject<ISecretsGateway>(SECRETS_GATEWAY);
  private readonly queryClient = injectQueryClient();

  readonly createVariable = injectMutation(() => ({
    mutationFn: (p: CreateVariableParams) => this.variablesGateway.CreateVariable(p.scope, p.level, p.name, p.value),
    onMutate: async (p) => {
      const snapshot = await this.SnapshotLedger();
      this.UpdateLedgerItems((items) => [...items, OptimisticVariable(p.level, p.scope, p.name, p.value)]);
      return { snapshot };
    },
    // Composite variables (`$(OtherVarName)` formulas) have their `formula`/`resolvedValue`/
    // `unresolvedReferences` computed server-side (the manifest lookup and the fresh resolve pass
    // both happen in api/Services/LedgerService.cs) — the optimistic patch above never sets those
    // fields. Invalidate on success so any composite row that depends on this one picks up its
    // freshly-resolved value on next refetch, mirroring EnvironmentsFacade's
    // renameEnvironment/copyEnvironmentVariables. The mutation's resolved value itself
    // (`{manifestSynced, manifestSyncError}`, see `IVariablesGateway.CreateVariable`) flows back to
    // whichever caller awaited `mutateAsync` — `ItemEditorPanelComponent` is the only current one
    // that reads it, to show a warning banner on a manifest-sync failure.
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['ledger'] });
    },
    onError: (_err, _p, context) => {
      if (context) this.RestoreLedger(context.snapshot);
    },
  }));

  /** Also handles renames — GitHub's update endpoint accepts a different `name` in the body. */
  readonly updateVariable = injectMutation(() => ({
    mutationFn: (p: UpdateVariableParams) =>
      this.variablesGateway.UpdateVariable(p.scope, p.level, p.currentName, p.newName, p.value),
    onMutate: async (p) => {
      const snapshot = await this.SnapshotLedger();
      this.UpdateLedgerItems((items) =>
        items.map((i) =>
          i.kind === 'variable' && i.level === p.level && i.name === p.currentName && SameScope(i.scope, p.scope)
            ? { ...i, name: p.newName, value: p.value, id: ItemId('variable', p.level, p.scope, p.newName) }
            : i,
        ),
      );
      return { snapshot };
    },
    // See createVariable's onSuccess above — composite rows elsewhere in the ledger may resolve
    // against this variable's new name/value. This also means the optimistic patch's `value: p.value`
    // above can briefly show a composite's raw formula (what the user typed) in place of the real,
    // already-resolved literal until this invalidate's refetch lands — a transient inaccuracy in the
    // same spirit as `resolvedValue`/`formula` never being set optimistically, self-corrected the
    // same way.
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['ledger'] });
    },
    onError: (_err, _p, context) => {
      if (context) this.RestoreLedger(context.snapshot);
    },
  }));

  readonly deleteVariable = injectMutation(() => ({
    mutationFn: (p: DeleteParams) => this.variablesGateway.DeleteVariable(p.scope, p.level, p.name),
    onMutate: async (p) => {
      const snapshot = await this.SnapshotLedger();
      this.UpdateLedgerItems((items) =>
        items.filter((i) => !(i.kind === 'variable' && i.level === p.level && i.name === p.name && SameScope(i.scope, p.scope))),
      );
      return { snapshot };
    },
    // See createVariable's onSuccess above — composite rows elsewhere in the ledger may have
    // referenced this now-deleted variable and need to show as unresolved.
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['ledger'] });
    },
    onError: (_err, _p, context) => {
      if (context) this.RestoreLedger(context.snapshot);
    },
  }));

  readonly putSecret = injectMutation(() => ({
    mutationFn: (p: SecretMutationParams) => this.secretsGateway.PutSecret(p.scope, p.level, p.name, p.value, p.options),
    onMutate: async (p) => {
      const snapshot = await this.SnapshotLedger();
      const matches = (i: LedgerItem) =>
        i.kind === 'secret' && i.level === p.level && i.name === p.name && SameScope(i.scope, p.scope);
      this.UpdateLedgerItems((items) =>
        items.some(matches)
          ? items.map((i) => (matches(i) ? { ...i, visibility: p.options?.visibility ?? i.visibility } : i))
          : [...items, OptimisticSecret(p.level, p.scope, p.name, p.options?.visibility)],
      );
      return { snapshot };
    },
    // See createVariable's onSuccess above — a secret's mere existence (name/visibility) can be
    // referenced by composite variables elsewhere in the ledger.
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['ledger'] });
    },
    onError: (_err, _p, context) => {
      if (context) this.RestoreLedger(context.snapshot);
    },
  }));

  /**
   * Secrets have no rename API — GitHub can't copy a value it never stores in the clear, so a
   * "rename" is really: create the new name (with the freshly-entered value), then delete the old
   * one. As of Phase 3b this is one backend call (`ISecretsGateway.RenameSecret`) doing both steps
   * server-side, rather than two sequential client-side mutation calls — but the backend still
   * can't make the two-step rename transactional (there's no GitHub API for that), so it reports
   * whether the delete step actually succeeded. The optimistic `onMutate` patch below assumes the
   * clean-rename case; `onSuccess` corrects the cache if that assumption turns out wrong.
   */
  readonly renameSecret = injectMutation(() => ({
    mutationFn: (p: RenameSecretParams) =>
      this.secretsGateway.RenameSecret(p.scope, p.level, p.currentName, p.newName, p.value, p.options),
    onMutate: async (p) => {
      const snapshot = await this.SnapshotLedger();
      this.UpdateLedgerItems((items) =>
        items.map((i) =>
          i.kind === 'secret' && i.level === p.level && i.name === p.currentName && SameScope(i.scope, p.scope)
            ? {
                ...i,
                name: p.newName,
                visibility: p.options?.visibility ?? i.visibility,
                id: ItemId('secret', p.level, p.scope, p.newName),
              }
            : i,
        ),
      );
      return { snapshot };
    },
    onSuccess: (result) => {
      // The PUT (new name) succeeded either way — only the DELETE (old name) step can have failed
      // here. If it did, GitHub genuinely still has both entries now, so the optimistic "clean
      // rename" patch above is wrong; invalidate so the next refetch shows the true state instead
      // of silently drifting from what GitHub actually has.
      if (!result.deleteSucceeded) {
        this.queryClient.invalidateQueries({ queryKey: ['ledger'] });
      }
    },
    onError: (_err, _p, context) => {
      if (context) this.RestoreLedger(context.snapshot);
    },
  }));

  readonly deleteSecret = injectMutation(() => ({
    mutationFn: (p: DeleteParams) => this.secretsGateway.DeleteSecret(p.scope, p.level, p.name),
    onMutate: async (p) => {
      const snapshot = await this.SnapshotLedger();
      this.UpdateLedgerItems((items) =>
        items.filter((i) => !(i.kind === 'secret' && i.level === p.level && i.name === p.name && SameScope(i.scope, p.scope))),
      );
      return { snapshot };
    },
    // See createVariable's onSuccess above — composite rows elsewhere in the ledger may have
    // referenced this now-deleted secret and need to show as unresolved.
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['ledger'] });
    },
    onError: (_err, _p, context) => {
      if (context) this.RestoreLedger(context.snapshot);
    },
  }));

  /** Snapshots every active ledger query so a failed optimistic update can roll back cleanly. */
  private async SnapshotLedger(): Promise<[QueryKey, LedgerResult | undefined][]> {
    await this.queryClient.cancelQueries({ queryKey: ['ledger'] });
    return this.queryClient.getQueriesData<LedgerResult>({ queryKey: ['ledger'] });
  }

  private RestoreLedger(snapshot: [QueryKey, LedgerResult | undefined][]): void {
    snapshot.forEach(([key, data]) => this.queryClient.setQueryData(key, data));
  }

  private UpdateLedgerItems(updater: (items: LedgerItem[]) => LedgerItem[]): void {
    this.queryClient.setQueriesData<LedgerResult>({ queryKey: ['ledger'] }, (old) =>
      old ? { ...old, items: updater(old.items) } : old,
    );
  }
}
