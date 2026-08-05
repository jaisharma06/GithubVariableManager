import { Injectable, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/AuthService';
import { SCOPES_GATEWAY, type IScopesGateway } from '../gateways/IScopesGateway';

/**
 * Facade over IScopesGateway — port of the useMyOrgs/useMyRepos/useOrgRepos/useIsOrgAccount
 * hooks in web/src/api/hooks.ts. Every query here is a *method*, not a shared field — this
 * facade is a `providedIn: 'root'` singleton, so a shared field would start fetching the moment
 * *any* consumer injects ScopesFacade for *any* reason (e.g. DashboardShellComponent only wants
 * IsOrgAccountQuery, but would eagerly trigger org/repo list fetches too if those were fields).
 * The original only ever calls useMyOrgs/useMyRepos from ScopePickerComponent — methods keep
 * that same one-query-per-actual-consumer behavior.
 */
@Injectable({ providedIn: 'root' })
export class ScopesFacade {
  private readonly scopesGateway = inject<IScopesGateway>(SCOPES_GATEWAY);
  private readonly authService = inject(AuthService);

  MyOrgsQuery() {
    return injectQuery(() => ({
      queryKey: ['orgs', this.authService.token()],
      queryFn: () => this.scopesGateway.ListMyOrgs(),
      enabled: !!this.authService.token(),
    }));
  }

  MyReposQuery() {
    return injectQuery(() => ({
      queryKey: ['repos', this.authService.token()],
      queryFn: () => this.scopesGateway.ListMyRepos(),
      enabled: !!this.authService.token(),
    }));
  }

  /** All repos in an org — used for the "selected repositories" secret-visibility picker (Phase 7). */
  OrgReposQuery(org: () => string | null, enabled: () => boolean) {
    return injectQuery(() => ({
      queryKey: ['org-repos', this.authService.token(), org()],
      queryFn: () => this.scopesGateway.ListOrgRepos(org()!),
      enabled: !!this.authService.token() && !!org() && enabled(),
    }));
  }

  /**
   * Whether a repo scope's owner is a real GitHub Organization (as opposed to a personal user
   * account, which has no org-level Actions variables/secrets at all). Only relevant for repo
   * scopes — the org picker (`/o/:org`) only ever lists real organizations already.
   */
  IsOrgAccountQuery(login: () => string | null) {
    return injectQuery(() => ({
      queryKey: ['account-type', this.authService.token(), login()],
      queryFn: () => this.scopesGateway.GetAccountType(login()!),
      enabled: !!this.authService.token() && !!login(),
      staleTime: Infinity,
      select: (type: 'User' | 'Organization') => type === 'Organization',
    }));
  }
}
