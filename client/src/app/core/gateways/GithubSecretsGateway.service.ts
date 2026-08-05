import { Injectable, inject } from '@angular/core';
import { SecretSealingService } from '../services/SecretSealingService';
import type { ItemLevel, LedgerItem, PublicKey, ScopeRef, SecretVisibility } from '../Types';
import { GithubHttp } from './GithubHttp.service';
import { Paginate } from './GithubPagination';
import { ItemId, SecretsPath } from './GithubPathBuilder';
import type { ISecretsGateway, PutSecretOptions } from './ISecretsGateway';

interface RawSecret {
  name: string;
  created_at: string;
  updated_at: string;
  visibility?: SecretVisibility;
}

/** Port of web/src/api/secrets.ts. */
@Injectable({ providedIn: 'root' })
export class GithubSecretsGateway implements ISecretsGateway {
  private readonly http = inject(GithubHttp);
  private readonly secretSealing = inject(SecretSealingService);

  async ListSecrets(scope: ScopeRef, level: ItemLevel): Promise<LedgerItem[]> {
    const items = await Paginate<RawSecret>(async (page) => {
      const data = await this.http.Get<{ total_count: number; secrets: RawSecret[] }>(
        `${SecretsPath(scope, level)}?per_page=100&page=${page}`,
      );
      return { totalCount: data.total_count, items: data.secrets };
    });

    return items.map((s) => ({
      id: ItemId('secret', level, scope, s.name),
      kind: 'secret' as const,
      level,
      scope,
      name: s.name,
      visibility: s.visibility,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));
  }

  async GetPublicKey(scope: ScopeRef, level: ItemLevel): Promise<PublicKey> {
    return this.http.Get<PublicKey>(`${SecretsPath(scope, level)}/public-key`);
  }

  async PutSecret(
    scope: ScopeRef,
    level: ItemLevel,
    name: string,
    plaintextValue: string,
    options?: PutSecretOptions,
  ): Promise<void> {
    const publicKey = await this.GetPublicKey(scope, level);
    const encryptedValue = await this.secretSealing.SealSecret(plaintextValue, publicKey.key);

    const body: Record<string, unknown> = { encrypted_value: encryptedValue, key_id: publicKey.key_id };
    if (level === 'organization') {
      const visibility = options?.visibility ?? 'all';
      body['visibility'] = visibility;
      if (visibility === 'selected') {
        body['selected_repository_ids'] = options?.selectedRepositoryIds ?? [];
      }
    }

    await this.http.Put(`${SecretsPath(scope, level)}/${encodeURIComponent(name)}`, body);
  }

  async DeleteSecret(scope: ScopeRef, level: ItemLevel, name: string): Promise<void> {
    await this.http.Delete(`${SecretsPath(scope, level)}/${encodeURIComponent(name)}`);
  }
}
