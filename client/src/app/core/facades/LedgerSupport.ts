// Pure, DI-free logic shared by LedgerFacade and ItemMutationsFacade — direct port of the
// top-level helper functions in web/src/api/hooks.ts. Kept separate from the two facades (rather
// than duplicated into each, or made private methods of one) since both genuinely need it:
// LedgerFacade to assemble a ledger read, ItemMutationsFacade to snapshot/restore/patch that same
// cached read optimistically.
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

export interface LedgerJob {
  level: ItemLevel;
  kind: ItemKind;
  scopeLabel: string;
  env?: string;
  promise: Promise<LedgerItem[]>;
}

function JobLabel(job: LedgerJob): string {
  const kindLabel = job.kind === 'variable' ? 'variables' : 'secrets';
  if (job.level === 'organization') return `organization ${kindLabel}`;
  if (job.level === 'repository') return `repository ${kindLabel}`;
  return `environment "${job.env}" ${kindLabel}`;
}

/**
 * Runs every list call independently so one failure doesn't blank the whole ledger.
 * A 403/404 (no rights to that level/kind) becomes a "locked" section, not a red error —
 * everything else (network errors, 5xx, rate limits) still surfaces as a real error.
 */
export async function RunLedgerJobs(jobs: LedgerJob[]): Promise<LedgerResult> {
  const settled = await Promise.allSettled(jobs.map((j) => j.promise));
  const items: LedgerItem[] = [];
  const partialErrors: LedgerPartialError[] = [];
  const lockedSections: LedgerLockedSection[] = [];

  settled.forEach((result, i) => {
    const job = jobs[i];
    if (result.status === 'fulfilled') {
      items.push(...result.value);
      return;
    }
    const err = result.reason;
    if (err instanceof GitHubApiError && (err.status === 403 || err.status === 404)) {
      lockedSections.push({ level: job.level, kind: job.kind, scopeLabel: job.scopeLabel, env: job.env });
      return;
    }
    partialErrors.push({ label: JobLabel(job), message: ErrorMessage(err) });
  });

  if (items.length === 0 && partialErrors.length > 0 && partialErrors.length === jobs.length) {
    throw new Error(partialErrors.map((e) => `${e.label} — ${e.message}`).join('; '));
  }

  return { items, partialErrors, lockedSections };
}
