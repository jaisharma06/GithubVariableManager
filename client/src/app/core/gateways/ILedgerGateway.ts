import { InjectionToken } from '@angular/core';
import type { ItemLevel, ItemKind, ScopeRef } from '../Types';
import type {
  CopyResult,
  CopyTarget,
  DeleteEverywhereResult,
  DeleteEverywhereTarget,
  EnvironmentVariableCopyResult,
} from '../facades/CopySupport';
import type { LedgerResult } from '../facades/LedgerSupport';
import type { PutSecretOptions } from './ISecretsGateway';

/** Preview-only result of resolving a composite variable's formula — see `ResolveVariable` below. Never written anywhere; purely for live authoring feedback. */
export interface ResolveVariableResult {
  resolvedValue?: string;
  unresolvedReferences: string[];
  circular: boolean;
  circularError?: string;
}

/** Result of a manual Sync — see `SyncVariable` below. Mirrors `api/Contracts/LedgerContracts.cs`'s `SyncVariableResponse`. */
export interface SyncVariableResult {
  resolvedValue: string;
  unresolvedReferences: string[];
}

/**
 * Per-target outcome of the global "Sync all" action — see `SyncAllVariables` below. Mirrors
 * `api/Contracts/LedgerContracts.cs`'s `SyncAllTargetResult`. `ok`/`synced` are independent flags:
 * `ok: true, synced: true` means resolved fresh and the value changed, so it was written;
 * `ok: true, synced: false` means resolved fresh but already current, so the write was skipped;
 * `ok: false` means a circular formula, a missing manifest entry, or a GitHub API error — `message`
 * is set in that case.
 */
export interface SyncAllTargetResult {
  target: { scope: ScopeRef; level: ItemLevel; name: string };
  ok: boolean;
  synced: boolean;
  resolvedValue?: string;
  message?: string;
}

/**
 * Talks to the `api/` ASP.NET Core backend's Ledger vertical (`Endpoints/LedgerEndpoints.cs`).
 * Started as purely the merged read (`GET /api/ledger`) — the variables + secrets + environment
 * fan-out and locked-section classification that used to be assembled client-side by
 * `LedgerFacade`/`LedgerSupport.RunLedgerJobs` now happens server-side in `Services/LedgerService.cs`.
 * As of Phase 6 it also covers the batch operations (`Copy`/`DeleteEverywhere`), mirroring
 * `IWorkflowsGateway`'s precedent of a Gateway growing from reads-only to include a bulk op that
 * belongs to the same vertical — this isn't scope creep, `POST /api/ledger/copy`/`delete-everywhere`
 * are Ledger-vertical routes operating on Ledger-vertical resources (variables/secrets), so a
 * separate Gateway interface for them would just split one vertical across two files. Reuses
 * `LedgerResult`/`LedgerPartialError`/`LedgerLockedSection` and `CopyTarget`/`CopyResult`/
 * `DeleteEverywhereTarget`/`DeleteEverywhereResult` from `core/facades/` for these shapes rather
 * than new duplicate types — those types describe already-decided data, not facade behavior, so
 * this Gateway depending on them (rather than the usual Facade-depends-on-Gateway direction) is the
 * right call here.
 */
export interface ILedgerGateway {
  GetLedger(org: string, repo?: string): Promise<LedgerResult>;
  Copy(
    kind: ItemKind,
    name: string,
    value: string,
    targets: CopyTarget[],
    options?: PutSecretOptions,
  ): Promise<CopyResult[]>;
  DeleteEverywhere(kind: ItemKind, name: string, targets: DeleteEverywhereTarget[]): Promise<DeleteEverywhereResult[]>;
  /** Downloads the current scope's ledger as an `.xlsx` workbook — `GET /api/ledger/export`. */
  ExportLedger(org: string, repo?: string): Promise<{ blob: Blob; filename: string }>;
  /**
   * Copies every variable from one environment to another — `POST /api/ledger/environments/copy-variables`.
   * `source`/`dest` are always fully environment-scoped (`org`+`repo`+`env` all set); not
   * restricted to the currently-open org/repo, since nothing in `api/`'s `ActionsRestClient` is
   * repo-bound. See `Services/EnvironmentVariableCopyService.cs`'s doc comment for the full design
   * (skip-if-exists by name, case-sensitive substring value replace, per-variable failure isolation).
   */
  CopyEnvironmentVariables(source: ScopeRef, dest: ScopeRef): Promise<EnvironmentVariableCopyResult>;
  /**
   * Preview-only composite-variable resolution — `POST /api/ledger/variables/resolve`. Never
   * writes anything; used for live authoring feedback as a `$(OtherVarName)` formula is typed.
   * `name` is the variable's own name (its current name while editing, or the name being typed for
   * a new variable) — needed so a direct self-reference is caught by the same circular-reference
   * check as any longer cycle, matching `api/Services/CompositeVariableResolver.cs`'s design.
   */
  ResolveVariable(scope: ScopeRef, level: ItemLevel, name: string, value: string): Promise<ResolveVariableResult>;
  /**
   * Manual recovery/refresh action — `POST /api/ledger/variables/sync`. Replaces the old "flatten
   * to literal" action 1:1: re-reads `name`'s formula from its scope's hidden manifest variable and
   * recomputes it against current sibling values, overwriting the real GitHub value in place. The
   * formula itself is untouched and stays saved for syncing again anytime — no `value`/`formula` is
   * sent, the server looks it up from its own manifest.
   */
  SyncVariable(scope: ScopeRef, level: ItemLevel, name: string): Promise<SyncVariableResult>;
  /**
   * One global "Sync all" action — `POST /api/ledger/variables/sync-all`. Re-syncs every composite
   * variable across the currently-open ledger in one batch call, reusing the per-row Sync machinery
   * server-side (`ItemMutationService.SyncCompositeVariableIfStaleAsync`), skipping any target
   * already up to date rather than writing it unconditionally the way a single-row Sync does. The
   * target list is caller-supplied (client-computed via `LedgerSupport.FindComposites` from
   * already-fetched ledger data), not re-enumerated server-side.
   */
  SyncAllVariables(targets: { scope: ScopeRef; level: ItemLevel; name: string }[]): Promise<SyncAllTargetResult[]>;
}

export const LEDGER_GATEWAY = new InjectionToken<ILedgerGateway>('LEDGER_GATEWAY');
