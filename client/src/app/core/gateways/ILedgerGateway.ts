import { InjectionToken } from '@angular/core';
import type { ItemKind, ScopeRef } from '../Types';
import type {
  CopyResult,
  CopyTarget,
  DeleteEverywhereResult,
  DeleteEverywhereTarget,
  EnvironmentVariableCopyResult,
} from '../facades/CopySupport';
import type { LedgerResult } from '../facades/LedgerSupport';
import type { PutSecretOptions } from './ISecretsGateway';

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
}

export const LEDGER_GATEWAY = new InjectionToken<ILedgerGateway>('LEDGER_GATEWAY');
