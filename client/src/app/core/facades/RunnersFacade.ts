import { Injectable, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/AuthService';
import { RUNNERS_GATEWAY, type IRunnersGateway } from '../gateways/IRunnersGateway';
import type { DashboardScope } from '../Types';

/**
 * Facade over IRunnersGateway — port of the useRunners hook. Self-hosted runners in scope: repo
 * runners for a repo scope, org runners for an org-only scope. As of Phase 4 (the ASP.NET Core
 * migration's Runners vertical), the repo-vs-org branching moved server-side
 * (`api/Services/RunnersService.cs`) — this Facade just forwards `org`/`repo` straight through.
 * Polled every 30s since online/offline/busy status is live state, not something a manual
 * mutation here ever changes — a one-off fetch would go stale the moment a runner picks up a job.
 */
@Injectable({ providedIn: 'root' })
export class RunnersFacade {
  private readonly runnersGateway = inject<IRunnersGateway>(RUNNERS_GATEWAY);
  private readonly authService = inject(AuthService);

  RunnersQuery(scope: () => DashboardScope | null) {
    return injectQuery(() => ({
      queryKey: ['runners', this.authService.token(), scope()?.org, scope()?.repo],
      queryFn: () => {
        const s = scope()!;
        return this.runnersGateway.ListRunners(s.org, s.repo);
      },
      enabled: !!this.authService.token() && !!scope(),
      refetchInterval: 30_000,
    }));
  }
}
