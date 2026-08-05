import { InjectionToken } from '@angular/core';
import type { Runner } from '../Types';

/** Port of web/src/api/runners.ts. */
export interface IRunnersGateway {
  /** Self-hosted runners assigned directly to a repo. */
  ListRepoRunners(owner: string, repo: string): Promise<Runner[]>;
  /** Self-hosted runners at the organization level. */
  ListOrgRunners(org: string): Promise<Runner[]>;
}

export const RUNNERS_GATEWAY = new InjectionToken<IRunnersGateway>('RUNNERS_GATEWAY');
