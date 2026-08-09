import { InjectionToken } from '@angular/core';
import type { ItemLevel, ScopeRef, SecretVisibility } from '../Types';

export interface PutSecretOptions {
  visibility?: SecretVisibility;
  selectedRepositoryIds?: number[];
}

export interface RenameSecretResult {
  deleteSucceeded: boolean;
  deleteError: string | null;
}

/**
 * As of Phase 3b (the ASP.NET Core migration's Secrets CRUD sub-phase), talks to `api/`'s Ledger
 * vertical — sealing (public-key fetch + libsodium sealed-box encryption) happens server-side now,
 * so this interface takes plaintext directly rather than doing any crypto itself. `ListSecrets`/
 * `GetPublicKey` are gone: reads go through `ILedgerGateway`'s merged backend read (same precedent
 * as `IVariablesGateway` dropping `ListVariables` in Phase 3a), and there's no longer a client-side
 * consumer of a scope's raw public key.
 */
export interface ISecretsGateway {
  PutSecret(
    scope: ScopeRef,
    level: ItemLevel,
    name: string,
    plaintextValue: string,
    options?: PutSecretOptions,
  ): Promise<void>;
  /**
   * GitHub has no rename API for secrets — the backend does create-under-new-name-then-delete-old
   * in one call and reports whether the delete step actually succeeded, since there's no GitHub API
   * making the two steps transactional. See `ItemMutationsFacade.renameSecret`'s `onSuccess` for how
   * a `false` `deleteSucceeded` is surfaced.
   */
  RenameSecret(
    scope: ScopeRef,
    level: ItemLevel,
    currentName: string,
    newName: string,
    plaintextValue: string,
    options?: PutSecretOptions,
  ): Promise<RenameSecretResult>;
  DeleteSecret(scope: ScopeRef, level: ItemLevel, name: string): Promise<void>;
}

export const SECRETS_GATEWAY = new InjectionToken<ISecretsGateway>('SECRETS_GATEWAY');
