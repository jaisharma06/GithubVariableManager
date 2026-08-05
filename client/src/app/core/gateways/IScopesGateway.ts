import { InjectionToken } from '@angular/core';
import type { GithubOrg, GithubRepo, Viewer } from '../Types';

/** Port of web/src/api/scopes.ts. */
export interface IScopesGateway {
  /** Takes an explicit token, not the ambient session — see AuthService.ConnectWithToken. */
  GetViewer(token: string): Promise<Viewer>;
  ListMyOrgs(): Promise<GithubOrg[]>;
  ListMyRepos(): Promise<GithubRepo[]>;
  /** All repos in an org — used for the "selected repositories" secret-visibility picker. */
  ListOrgRepos(org: string): Promise<GithubRepo[]>;
  /**
   * Org-level Actions variables/secrets only exist for real Organization accounts — a repo owned
   * by a personal User account has no such thing, and GitHub 404s /orgs/{login}/... for one.
   */
  GetAccountType(login: string): Promise<'User' | 'Organization'>;
}

export const SCOPES_GATEWAY = new InjectionToken<IScopesGateway>('SCOPES_GATEWAY');
