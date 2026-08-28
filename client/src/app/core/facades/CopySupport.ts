// Shared types for CopyFacade and DeleteEverywhereFacade — port of the equivalent interfaces in
// web/src/api/hooks.ts.
import type { ItemLevel, ScopeRef } from '../Types';

export interface CopyTarget {
  level: ItemLevel;
  scope: ScopeRef;
}

export interface CopyResult {
  target: CopyTarget;
  ok: boolean;
  message?: string;
}

export interface DeleteEverywhereTarget {
  level: ItemLevel;
  scope: ScopeRef;
}

export interface DeleteEverywhereResult {
  target: DeleteEverywhereTarget;
  ok: boolean;
  message?: string;
}

/** Result shape for `ILedgerGateway.CopyEnvironmentVariables` — port of `api/`'s `CopyEnvironmentVariablesResponse`. */
export interface EnvironmentVariableCopyFailure {
  name: string;
  message: string;
}

export interface EnvironmentVariableCopyResult {
  listSourceError?: string;
  copied: string[];
  skipped: string[];
  failures: EnvironmentVariableCopyFailure[];
}
