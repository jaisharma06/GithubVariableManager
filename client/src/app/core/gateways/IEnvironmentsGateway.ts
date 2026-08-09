import { InjectionToken } from '@angular/core';
import type { GithubEnvironment } from '../Types';

export interface RenameEnvironmentParams {
  org: string;
  repo: string;
  oldName: string;
  newName: string;
  deleteOldAnyway: boolean;
}

export interface VariableCopyFailure {
  name: string;
  error: string;
}

export interface RenameEnvironmentResult {
  listVariablesError: string | null;
  variablesCopied: number;
  variableCopyFailures: VariableCopyFailure[];
  oldEnvironmentDeleted: boolean;
  oldEnvironmentDeleteError: string | null;
}

/**
 * As of Phase 3c (the ASP.NET Core migration's Environments CRUD/rename sub-phase), talks to
 * `api/`'s Ledger vertical — `BackendEnvironmentsGateway.service.ts` is the only implementation.
 * GitHub has no rename endpoint for environments, so `RenameEnvironment` is really
 * create-under-new-name, copy every environment-level variable's value across, then conditionally
 * delete-old, done in one backend call now (`api/Services/EnvironmentRenameService.cs`) rather than
 * three sequential client-side mutations. See `RenameEnvironmentResult`'s fields for the reported
 * outcome: `listVariablesError`/`variableCopyFailures` reflect the old environment being left in
 * place whenever anything after creation didn't fully succeed, and `oldEnvironmentDeleteError`
 * reflects a rename that otherwise succeeded but whose cleanup step failed — same
 * report-exactly-what-happened philosophy as `ISecretsGateway.RenameSecret`.
 */
export interface IEnvironmentsGateway {
  ListEnvironments(org: string, repo: string): Promise<GithubEnvironment[]>;
  /** Creates the environment if it doesn't exist yet (GitHub's PUT is create-or-update). */
  CreateEnvironment(org: string, repo: string, name: string): Promise<void>;
  DeleteEnvironment(org: string, repo: string, name: string): Promise<void>;
  RenameEnvironment(params: RenameEnvironmentParams): Promise<RenameEnvironmentResult>;
}

export const ENVIRONMENTS_GATEWAY = new InjectionToken<IEnvironmentsGateway>('ENVIRONMENTS_GATEWAY');
