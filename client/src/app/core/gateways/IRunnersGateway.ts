import { InjectionToken } from '@angular/core';
import type { Runner } from '../Types';

/**
 * As of Phase 4 (the ASP.NET Core migration's Runners vertical), talks to `api/`'s Runners
 * vertical — `BackendRunnersGateway.service.ts` is the only implementation. Collapsed to one
 * method: the org-vs-repo branching that used to live in `RunnersFacade` (calling either
 * `ListRepoRunners`/`ListOrgRunners`) now happens server-side in
 * `api/Services/RunnersService.cs`, keyed off whether `repo` is supplied.
 */
export interface IRunnersGateway {
  ListRunners(org: string, repo?: string): Promise<Runner[]>;
}

export const RUNNERS_GATEWAY = new InjectionToken<IRunnersGateway>('RUNNERS_GATEWAY');
