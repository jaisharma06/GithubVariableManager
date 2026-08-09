// Pure, DI-free logic shared by ItemMutationsFacade (and the response-shaping types consumed by
// ILedgerGateway) — direct port of the shared helper functions/types in web/src/api/hooks.ts.
// RunLedgerJobs/JobLabel/LedgerJob (the client-side fan-out) were removed once that logic moved
// server-side into api/Services/LedgerService.cs — see LedgerFacade.ts, now a thin ILedgerGateway
// query wrapper.
import { GitHubApiError } from '../gateways/GitHubApiError';
import { ItemId } from '../gateways/GithubPathBuilder';
import type { ItemKind, ItemLevel, LedgerItem, ScopeRef } from '../Types';

export function SameScope(a: ScopeRef, b: ScopeRef): boolean {
  return a.org === b.org && a.repo === b.repo && a.env === b.env;
}

export function ErrorMessage(err: unknown): string {
  return err instanceof GitHubApiError
    ? `${err.message} (HTTP ${err.status})`
    : err instanceof Error
      ? err.message
      : 'Unknown error';
}

export function OptimisticVariable(level: ItemLevel, scope: ScopeRef, name: string, value: string): LedgerItem {
  const now = new Date().toISOString();
  return { id: ItemId('variable', level, scope, name), kind: 'variable', level, scope, name, value, createdAt: now, updatedAt: now };
}

export function OptimisticSecret(
  level: ItemLevel,
  scope: ScopeRef,
  name: string,
  visibility?: LedgerItem['visibility'],
): LedgerItem {
  const now = new Date().toISOString();
  return { id: ItemId('secret', level, scope, name), kind: 'secret', level, scope, name, visibility, createdAt: now, updatedAt: now };
}

export interface LedgerPartialError {
  label: string;
  message: string;
}

/** A level/kind combo the current token has no rights to see (403/404) — shown as "locked", not an error. */
export interface LedgerLockedSection {
  level: ItemLevel;
  kind: ItemKind;
  scopeLabel: string;
  env?: string;
}

export interface LedgerResult {
  items: LedgerItem[];
  partialErrors: LedgerPartialError[];
  lockedSections: LedgerLockedSection[];
}
