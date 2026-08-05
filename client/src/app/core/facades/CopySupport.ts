// Shared types for CopyFacade and (Phase 8) DeleteEverywhereFacade — port of the equivalent
// interfaces in web/src/api/hooks.ts.
import type { ItemLevel, ScopeRef } from '../Types';

export interface CopyTarget {
  level: ItemLevel;
  scope: ScopeRef;
  /** Whether this destination already has an item of the same name — decides create vs. update. */
  exists: boolean;
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
