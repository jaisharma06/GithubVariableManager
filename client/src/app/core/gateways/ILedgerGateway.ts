import { InjectionToken } from '@angular/core';
import type { ItemKind } from '../Types';
import type { CopyResult, CopyTarget, DeleteEverywhereResult, DeleteEverywhereTarget } from '../facades/CopySupport';
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
}

export const LEDGER_GATEWAY = new InjectionToken<ILedgerGateway>('LEDGER_GATEWAY');
