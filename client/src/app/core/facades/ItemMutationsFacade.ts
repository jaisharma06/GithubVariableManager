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
    onError: (_err, _p, context) => {
      if (context) this.RestoreLedger(context.snapshot);
    },
  }));

  /**
   * Secrets have no rename API — GitHub can't copy a value it never stores in the clear, so a
   * "rename" is really: create the new name (with the freshly-entered value), then delete the old one.
   */
  readonly renameSecret = injectMutation(() => ({
    mutationFn: async (p: RenameSecretParams) => {
      await this.secretsGateway.PutSecret(p.scope, p.level, p.newName, p.value, p.options);
      await this.secretsGateway.DeleteSecret(p.scope, p.level, p.currentName);
    },
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
