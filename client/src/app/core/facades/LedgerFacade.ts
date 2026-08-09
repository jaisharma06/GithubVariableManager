import { Injectable, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/AuthService';
import { LEDGER_GATEWAY, type ILedgerGateway } from '../gateways/ILedgerGateway';
import type { DashboardScope } from '../Types';

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
}
