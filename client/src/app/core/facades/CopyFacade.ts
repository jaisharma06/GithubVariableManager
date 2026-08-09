import { Injectable, inject } from '@angular/core';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { LEDGER_GATEWAY, type ILedgerGateway } from '../gateways/ILedgerGateway';
import type { PutSecretOptions } from '../gateways/ISecretsGateway';
import type { ItemKind } from '../Types';
import type { CopyResult, CopyTarget } from './CopySupport';

/**
 * Pushes one variable/secret's value out to a batch of other scopes — port of the useCopyItem
 * hook. As of Phase 6 this is one `ILedgerGateway.Copy` call, fanned out server-side
 * (`Services/CopyService.cs`) over every target, rather than a client-side `Promise.allSettled`
 * composing `ItemMutationsFacade`'s per-item mutations. Deliberately no optimistic `onMutate`
 * patch here, the same tradeoff `EnvironmentsFacade.renameEnvironment` already made in Phase 3c
 * when its 3-step client sequence collapsed to one backend call: hand-rolling an equivalent
 * multi-target optimistic patch is high-risk for low payoff, so `onSuccess` invalidates the ledger
 * query instead, accepting a brief refetch flicker as an honest tradeoff.
 */
@Injectable({ providedIn: 'root' })
export class CopyFacade {
  private readonly ledgerGateway = inject<ILedgerGateway>(LEDGER_GATEWAY);
  private readonly queryClient = injectQueryClient();

  private readonly copy = injectMutation(() => ({
    mutationFn: (p: { kind: ItemKind; name: string; value: string; targets: CopyTarget[]; options?: PutSecretOptions }) =>
      this.ledgerGateway.Copy(p.kind, p.name, p.value, p.targets, p.options),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['ledger'] }),
  }));

  readonly isPending = this.copy.isPending;

  async CopyTo(
    kind: ItemKind,
    name: string,
    value: string,
    targets: CopyTarget[],
    options?: PutSecretOptions,
  ): Promise<CopyResult[]> {
    return this.copy.mutateAsync({ kind, name, value, targets, options });
  }
}
