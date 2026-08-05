import { Injectable, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/AuthService';
import { VARIABLES_GATEWAY, type IVariablesGateway } from '../gateways/IVariablesGateway';
import { SECRETS_GATEWAY, type ISecretsGateway } from '../gateways/ISecretsGateway';
import type { DashboardScope, ScopeRef } from '../Types';
import { EnvironmentsFacade } from './EnvironmentsFacade';
import { ScopesFacade } from './ScopesFacade';
import { RunLedgerJobs, type LedgerJob } from './LedgerSupport';

/**
 * Facade assembling the ledger — port of the useLedger hook. Composes EnvironmentsFacade and
 * ScopesFacade internally (exactly like the original hook calls useEnvironments/useIsOrgAccount
 * itself), rather than requiring the caller to wire those up — DashboardShellComponent also
 * queries them directly for its own needs (the sidebar's environment list, the header's
 * showOrgLevel), and TanStack Query's cache deduplicates the two call sites down to one shared
 * read per queryKey, same as the original.
 */
@Injectable({ providedIn: 'root' })
export class LedgerFacade {
  private readonly variablesGateway = inject<IVariablesGateway>(VARIABLES_GATEWAY);
  private readonly secretsGateway = inject<ISecretsGateway>(SECRETS_GATEWAY);
  private readonly authService = inject(AuthService);
  private readonly environmentsFacade = inject(EnvironmentsFacade);
  private readonly scopesFacade = inject(ScopesFacade);

  /**
   * Org scope alone → org-level only. Repo scope → repo + every environment on that repo, plus
   * org-level too if (and only if) the repo's owner is an actual Organization account.
   */
  LedgerQuery(scope: () => DashboardScope | null) {
    const environmentsQuery = this.environmentsFacade.EnvironmentsQuery(
      () => scope()?.org ?? '',
      () => scope()?.repo,
    );
    const isOrgAccountQuery = this.scopesFacade.IsOrgAccountQuery(() => (scope()?.repo ? (scope()!.org) : null));

    const environments = () => environmentsQuery.data() ?? [];
    const environmentsReady = () => !scope()?.repo || environmentsQuery.isSuccess();
    // Org-only scopes are always real orgs (see ScopePickerComponent); repo scopes need the account-type check.
    const orgLevelApplies = () => !scope()?.repo || isOrgAccountQuery.data() === true;
    const orgLevelReady = () => !scope()?.repo || isOrgAccountQuery.isSuccess() || isOrgAccountQuery.isError();

    return injectQuery(() => ({
      queryKey: [
        'ledger',
        this.authService.token(),
        scope()?.org,
        scope()?.repo,
        environments()
          .map((e) => e.name)
          .join(','),
        orgLevelApplies(),
      ],
      queryFn: async () => {
        const s = scope()!;
        const jobs: LedgerJob[] = orgLevelApplies()
          ? [
              {
                level: 'organization',
                kind: 'variable',
                scopeLabel: s.org,
                promise: this.variablesGateway.ListVariables({ org: s.org }, 'organization'),
              },
              {
                level: 'organization',
                kind: 'secret',
                scopeLabel: s.org,
                promise: this.secretsGateway.ListSecrets({ org: s.org }, 'organization'),
              },
            ]
          : [];

        if (s.repo) {
          jobs.push(
            {
              level: 'repository',
              kind: 'variable',
              scopeLabel: s.repo,
              promise: this.variablesGateway.ListVariables({ org: s.org, repo: s.repo }, 'repository'),
            },
            {
              level: 'repository',
              kind: 'secret',
              scopeLabel: s.repo,
              promise: this.secretsGateway.ListSecrets({ org: s.org, repo: s.repo }, 'repository'),
            },
          );
          for (const env of environments()) {
            const envScope: ScopeRef = { org: s.org, repo: s.repo, env: env.name };
            jobs.push(
              {
                level: 'environment',
                kind: 'variable',
                scopeLabel: env.name,
                env: env.name,
                promise: this.variablesGateway.ListVariables(envScope, 'environment'),
              },
              {
                level: 'environment',
                kind: 'secret',
                scopeLabel: env.name,
                env: env.name,
                promise: this.secretsGateway.ListSecrets(envScope, 'environment'),
              },
            );
          }
        }

        return RunLedgerJobs(jobs);
      },
      enabled: !!this.authService.token() && !!scope() && environmentsReady() && orgLevelReady(),
    }));
  }
}
