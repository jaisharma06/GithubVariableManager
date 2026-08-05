import { InjectionToken } from '@angular/core';
import type { ItemLevel, LedgerItem, ScopeRef } from '../Types';

/** Port of web/src/api/variables.ts. */
export interface IVariablesGateway {
  ListVariables(scope: ScopeRef, level: ItemLevel): Promise<LedgerItem[]>;
  CreateVariable(scope: ScopeRef, level: ItemLevel, name: string, value: string): Promise<void>;
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
  ): Promise<void>;
  DeleteVariable(scope: ScopeRef, level: ItemLevel, name: string): Promise<void>;
}

export const VARIABLES_GATEWAY = new InjectionToken<IVariablesGateway>('VARIABLES_GATEWAY');
