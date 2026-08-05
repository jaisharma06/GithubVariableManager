import { InjectionToken } from '@angular/core';
import type { GithubEnvironment } from '../Types';

/** Port of web/src/api/environments.ts. GitHub has no rename endpoint — see
 * RenameEnvironmentDialog (Phase 5) for the create+copy+delete approach that stands in for one. */
export interface IEnvironmentsGateway {
  ListEnvironments(owner: string, repo: string): Promise<GithubEnvironment[]>;
  /** Creates the environment if it doesn't exist yet (GitHub's PUT is create-or-update). */
  CreateEnvironment(owner: string, repo: string, name: string): Promise<void>;
  DeleteEnvironment(owner: string, repo: string, name: string): Promise<void>;
}

export const ENVIRONMENTS_GATEWAY = new InjectionToken<IEnvironmentsGateway>('ENVIRONMENTS_GATEWAY');
