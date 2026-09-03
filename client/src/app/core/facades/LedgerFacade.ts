import { Injectable, inject } from '@angular/core';
import { injectMutation, injectQuery, injectQueryClient } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/AuthService';
import { LEDGER_GATEWAY, type ILedgerGateway, type ResolveVariableResult } from '../gateways/ILedgerGateway';
import type { DashboardScope, ItemLevel, ScopeRef } from '../Types';

interface SyncVariableParams {
  scope: ScopeRef;
  level: ItemLevel;
  name: string;
}

/**
 * Facade over `ILedgerGateway`'s merged read. The variables/secrets/environment fan-out and
 * locked-section classification that used to be assembled here (via `EnvironmentsFacade`/
 * `ScopesFacade` composition and `LedgerSupport.RunLedgerJobs`) now lives server-side in
 * `api/Services/LedgerService.cs`, per the ASP.NET Core migration's "business/API decision logic
 * belongs in `api/`" rule — this Facade now only wires up the query.
 */
@Injectable({ providedIn: 'root' })
export class LedgerFacade {
  private readonly ledgerGateway = inject<ILedgerGateway>(LEDGER_GATEWAY);
  private readonly authService = inject(AuthService);
  private readonly queryClient = injectQueryClient();

  LedgerQuery(scope: () => DashboardScope | null) {
    return injectQuery(() => ({
      queryKey: ['ledger', this.authService.token(), scope()?.org, scope()?.repo],
      queryFn: () => this.ledgerGateway.GetLedger(scope()!.org, scope()!.repo),
      enabled: !!this.authService.token() && !!scope(),
    }));
  }

  /**
   * Deliberately not an `injectQuery`/`injectMutation` field — a one-shot imperative action with
   * no cache-worthy state, mirroring `WorkflowsFacade.DeleteRuns`'s existing precedent. The caller
   * owns its own pending signal.
   */
  async ExportLedger(org: string, repo?: string): Promise<{ blob: Blob; filename: string }> {
    return this.ledgerGateway.ExportLedger(org, repo);
  }

  /**
   * Preview-only composite-variable resolution, same one-shot imperative shape as `ExportLedger`
   * above — no cache-worthy state, the caller (`ItemEditorPanelComponent`'s live-resolve preview)
   * owns its own pending/result signals.
   */
  async ResolveVariable(scope: ScopeRef, level: ItemLevel, name: string, value: string): Promise<ResolveVariableResult> {
    return this.ledgerGateway.ResolveVariable(scope, level, name, value);
  }

  /**
   * Manual Sync — unlike `ResolveVariable` above, this genuinely writes GitHub state (overwrites
   * the real value with today's resolved literal), so it's a proper `injectMutation`, not a bare
   * passthrough: callers need `.isPending()`/error state the way `EnvironmentsFacade.renameEnvironment`
   * and the batch-op Facades already provide. No optimistic `onMutate` — the resolved value can't be
   * guessed client-side (it depends on sibling values only the server has read fresh), matching the
   * same "collapse to one call, skip the optimistic patch" tradeoff those Facades already made.
   */
  readonly syncVariable = injectMutation(() => ({
    mutationFn: (p: SyncVariableParams) => this.ledgerGateway.SyncVariable(p.scope, p.level, p.name),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['ledger'] });
    },
  }));
}
