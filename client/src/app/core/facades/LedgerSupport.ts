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

// Composite-variable support (Azure-App-Config-style $(OtherVarName) formulas, variables only).
// GitHub has no concept of this — the stored value IS the formula, and "is composite" is always
// derived by matching this pattern rather than stored as a separate flag. Kept in sync with
// api/Services/CompositeVariableResolver.cs's ReferencePattern (same regex, same "a GitHub Actions
// variable name is letters/digits/underscore, must not start with a digit" rule). Two patterns —
// one without the global flag for IsCompositeValue's .test(), one with it for ExtractReferences'
// .matchAll() — a shared global-flag regex would carry lastIndex state between calls and silently
// break repeated .test() calls.
const COMPOSITE_PATTERN = /\$\([A-Za-z_][A-Za-z0-9_]*\)/;
const COMPOSITE_PATTERN_GLOBAL = /\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g;

export function IsCompositeValue(value: string): boolean {
  return COMPOSITE_PATTERN.test(value);
}

export function ExtractReferences(value: string): string[] {
  return [...new Set([...value.matchAll(COMPOSITE_PATTERN_GLOBAL)].map((m) => m[1]))];
}

/**
 * Is `candidateScope` reachable from `targetScope`'s own precedence chain? Mirrors GitHub Actions'
 * real override chain — environment > repository > organization: an organization-level target is
 * visible to every repository/environment in that org; a repository-level target is visible to
 * every environment in that repo; an environment-level target is only visible to that exact
 * environment. Used both directions — `CompositeVariableResolver`-style lookup building isn't
 * needed client-side (that stays server-side), but the same reachability rule is what makes
 * `FindDependents` below correct.
 */
function InScopeChain(candidateScope: ScopeRef, targetScope: ScopeRef): boolean {
  if (candidateScope.org !== targetScope.org) return false;
  if (!targetScope.repo) return true;
  if (candidateScope.repo !== targetScope.repo) return false;
  if (!targetScope.env) return true;
  return candidateScope.env === targetScope.env;
}

/**
 * Reverse-dependency scan over already-fetched ledger data: every variable whose formula
 * references `name` at `scope`, restricted to items that could actually see that name per the
 * env > repo > org precedence chain (so a same-named variable at an unrelated scope never shows up
 * as a false-positive dependent). Pure, DI-free — used by Ledger.component.ts/CompareView.component.ts
 * to warn "N other variables reference this" on a delete-confirmation dialog, matching this file's
 * existing free-function convention (SameScope, OptimisticVariable, …) rather than a Facade method,
 * since it's a synchronous scan over data the caller already has, not a query/mutation.
 */
export function FindDependents(items: LedgerItem[], name: string, scope: ScopeRef): LedgerItem[] {
  return items.filter(
    (item) =>
      item.kind === 'variable' &&
      item.value !== undefined &&
      !(item.name === name && SameScope(item.scope, scope)) &&
      IsCompositeValue(item.value) &&
      ExtractReferences(item.value).includes(name) &&
      InScopeChain(item.scope, scope),
  );
}
