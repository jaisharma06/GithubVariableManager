import { InjectionToken } from '@angular/core';
import type { ItemLevel, LedgerItem, PublicKey, ScopeRef, SecretVisibility } from '../Types';

export interface PutSecretOptions {
  visibility?: SecretVisibility;
  selectedRepositoryIds?: number[];
}

/** Port of web/src/api/secrets.ts. */
export interface ISecretsGateway {
  ListSecrets(scope: ScopeRef, level: ItemLevel): Promise<LedgerItem[]>;
  GetPublicKey(scope: ScopeRef, level: ItemLevel): Promise<PublicKey>;
  PutSecret(
    scope: ScopeRef,
    level: ItemLevel,
    name: string,
    plaintextValue: string,
    options?: PutSecretOptions,
  ): Promise<void>;
  DeleteSecret(scope: ScopeRef, level: ItemLevel, name: string): Promise<void>;
}

export const SECRETS_GATEWAY = new InjectionToken<ISecretsGateway>('SECRETS_GATEWAY');
