import { Injectable, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/AuthService';
import { LEDGER_GATEWAY, type ILedgerGateway, type ResolveVariableResult } from '../gateways/ILedgerGateway';
import type { DashboardScope, ItemLevel, ScopeRef } from '../Types';

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
}
