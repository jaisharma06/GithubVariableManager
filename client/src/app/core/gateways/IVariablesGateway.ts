import { InjectionToken } from '@angular/core';
import type { ItemLevel, ScopeRef } from '../Types';

/** Outcome of a variable create/rename write's best-effort composite-manifest update — mirrors `api/Contracts/LedgerContracts.cs`'s `UpsertVariableResponse`. The variable write itself always succeeded by the time this resolves; `manifestSynced: false` only means the app "forgot" this variable was a formula (recoverable by re-saving), never that the write itself failed. */
export interface UpsertVariableResult {
  manifestSynced: boolean;
  manifestSyncError?: string;
}

/**
 * Variables CRUD against the `api/` ASP.NET Core backend's Ledger vertical. `ListVariables` was
 * dropped once `LedgerFacade` moved to `ILedgerGateway`'s merged read (`ILedgerGateway.ts`) —
 * this interface now only covers the mutations.
 */
export interface IVariablesGateway {
  CreateVariable(scope: ScopeRef, level: ItemLevel, name: string, value: string): Promise<UpsertVariableResult>;
  /**
   * `currentName` selects the variable being updated (the URL); `newName` is what GitHub
   * actually renames it to if different — this endpoint doubles as a rename.
   */
  UpdateVariable(
    scope: ScopeRef,
    level: ItemLevel,
    currentName: string,
    newName: string,
    value: string,
  ): Promise<UpsertVariableResult>;
  DeleteVariable(scope: ScopeRef, level: ItemLevel, name: string): Promise<void>;
}

export const VARIABLES_GATEWAY = new InjectionToken<IVariablesGateway>('VARIABLES_GATEWAY');
