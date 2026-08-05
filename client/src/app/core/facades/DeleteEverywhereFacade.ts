import { Injectable, computed, inject } from '@angular/core';
import type { ItemKind } from '../Types';
import type { DeleteEverywhereResult, DeleteEverywhereTarget } from './CopySupport';
import { ItemMutationsFacade } from './ItemMutationsFacade';
import { ErrorMessage } from './LedgerSupport';

/**
 * Deletes one variable/secret, by name, from every scope it's currently set in — port of the
 * useDeleteEverywhere hook. Mirrors CopyFacade's shape: reuses ItemMutationsFacade's per-item
 * delete mutations rather than duplicating the delete-call logic, and attempts every target
 * independently (Promise.allSettled) so one failure doesn't hide whether the rest succeeded.
 */
@Injectable({ providedIn: 'root' })
export class DeleteEverywhereFacade {
  private readonly itemMutations = inject(ItemMutationsFacade);

  readonly isPending = computed(
    () => this.itemMutations.deleteVariable.isPending() || this.itemMutations.deleteSecret.isPending(),
  );

  async DeleteFrom(kind: ItemKind, name: string, targets: DeleteEverywhereTarget[]): Promise<DeleteEverywhereResult[]> {
    const settled = await Promise.allSettled(
      targets.map((t) =>
        kind === 'variable'
          ? this.itemMutations.deleteVariable.mutateAsync({ scope: t.scope, level: t.level, name })
          : this.itemMutations.deleteSecret.mutateAsync({ scope: t.scope, level: t.level, name }),
      ),
    );
    return settled.map((result, i) => ({
      target: targets[i],
      ok: result.status === 'fulfilled',
      message: result.status === 'rejected' ? ErrorMessage(result.reason) : undefined,
    }));
  }
}
