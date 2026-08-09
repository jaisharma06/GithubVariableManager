import { Injectable, inject } from '@angular/core';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { LEDGER_GATEWAY, type ILedgerGateway } from '../gateways/ILedgerGateway';
import type { ItemKind } from '../Types';
import type { DeleteEverywhereResult, DeleteEverywhereTarget } from './CopySupport';

/**
 * Deletes one variable/secret, by name, from every scope it's currently set in — port of the
 * useDeleteEverywhere hook. Structural twin of `CopyFacade`'s Phase 6 rewrite: one
 * `ILedgerGateway.DeleteEverywhere` call, fanned out server-side (`Services/DeleteEverywhereService.cs`)
 * over every target, rather than a client-side `Promise.allSettled` composing
 * `ItemMutationsFacade.deleteVariable`/`deleteSecret`. Same dropped-optimistic-update tradeoff as
 * `CopyFacade` — see its doc comment (which cites the `EnvironmentsFacade.renameEnvironment`
 * precedent) for the reasoning; `onSuccess` invalidates the ledger query instead.
 */
@Injectable({ providedIn: 'root' })
export class DeleteEverywhereFacade {
  private readonly ledgerGateway = inject<ILedgerGateway>(LEDGER_GATEWAY);
  private readonly queryClient = injectQueryClient();

  private readonly deleteEverywhere = injectMutation(() => ({
    mutationFn: (p: { kind: ItemKind; name: string; targets: DeleteEverywhereTarget[] }) =>
      this.ledgerGateway.DeleteEverywhere(p.kind, p.name, p.targets),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['ledger'] }),
  }));

  readonly isPending = this.deleteEverywhere.isPending;

  async DeleteFrom(kind: ItemKind, name: string, targets: DeleteEverywhereTarget[]): Promise<DeleteEverywhereResult[]> {
    return this.deleteEverywhere.mutateAsync({ kind, name, targets });
  }
}
