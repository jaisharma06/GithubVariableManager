import { Injectable, computed, inject } from '@angular/core';
import type { PutSecretOptions } from '../gateways/ISecretsGateway';
import type { ItemKind } from '../Types';
import { ErrorMessage } from './LedgerSupport';
import { ItemMutationsFacade } from './ItemMutationsFacade';
import type { CopyResult, CopyTarget } from './CopySupport';

/**
 * Pushes one variable/secret's value out to a batch of other scopes, reusing
 * ItemMutationsFacade's create/update/put mutations (and their optimistic-update behavior) each
 * destination already goes through individually. Every target is attempted independently so one
 * failure doesn't hide whether the rest succeeded. Port of the useCopyItem hook.
 */
@Injectable({ providedIn: 'root' })
export class CopyFacade {
  private readonly itemMutations = inject(ItemMutationsFacade);

  readonly isPending = computed(
    () =>
      this.itemMutations.createVariable.isPending() ||
      this.itemMutations.updateVariable.isPending() ||
      this.itemMutations.putSecret.isPending(),
  );

  async CopyTo(
    kind: ItemKind,
    name: string,
    value: string,
    targets: CopyTarget[],
    options?: PutSecretOptions,
  ): Promise<CopyResult[]> {
    const settled = await Promise.allSettled(
      targets.map((t) =>
        kind === 'variable'
          ? t.exists
            ? this.itemMutations.updateVariable.mutateAsync({
                scope: t.scope,
                level: t.level,
                currentName: name,
                newName: name,
                value,
              })
            : this.itemMutations.createVariable.mutateAsync({ scope: t.scope, level: t.level, name, value })
          : this.itemMutations.putSecret.mutateAsync({ scope: t.scope, level: t.level, name, value, options }),
      ),
    );
    return settled.map((result, i) => ({
      target: targets[i],
      ok: result.status === 'fulfilled',
      message: result.status === 'rejected' ? ErrorMessage(result.reason) : undefined,
    }));
  }
}
