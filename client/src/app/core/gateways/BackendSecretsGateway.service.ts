import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { ItemLevel, ScopeRef } from '../Types';
import type { ISecretsGateway, PutSecretOptions, RenameSecretResult } from './ISecretsGateway';

/**
 * Talks to the `api/` ASP.NET Core backend's Ledger vertical (`Endpoints/LedgerEndpoints.cs`)
 * rather than api.github.com directly — mirrors `BackendVariablesGateway.service.ts`'s shape
 * exactly (injects `HttpClient` directly; no GitHub Accept/API-Version headers
 * needed, `AuthInterceptor`'s ambient `Authorization: Bearer` attachment covers every call here).
 * Sealing (public-key fetch + libsodium sealed-box encryption) happens server-side now — this
 * Gateway just sends plaintext over the same bearer-token-authenticated request, same as every
 * other request to `api/`.
 */
@Injectable({ providedIn: 'root' })
export class BackendSecretsGateway implements ISecretsGateway {
  private readonly http = inject(HttpClient);

  async PutSecret(
    scope: ScopeRef,
    level: ItemLevel,
    name: string,
    plaintextValue: string,
    options?: PutSecretOptions,
  ): Promise<void> {
    await firstValueFrom(
      this.http.put(`${environment.backendApiBaseUrl}/api/ledger/secrets`, {
        org: scope.org,
        repo: scope.repo,
        env: scope.env,
        level,
        name,
        value: plaintextValue,
        visibility: options?.visibility,
        selectedRepositoryIds: options?.selectedRepositoryIds,
      }),
    );
  }

  async RenameSecret(
    scope: ScopeRef,
    level: ItemLevel,
    currentName: string,
    newName: string,
    plaintextValue: string,
    options?: PutSecretOptions,
  ): Promise<RenameSecretResult> {
    return firstValueFrom(
      this.http.patch<RenameSecretResult>(`${environment.backendApiBaseUrl}/api/ledger/secrets`, {
        org: scope.org,
        repo: scope.repo,
        env: scope.env,
        level,
        currentName,
        newName,
        value: plaintextValue,
        visibility: options?.visibility,
        selectedRepositoryIds: options?.selectedRepositoryIds,
      }),
    );
  }

  async DeleteSecret(scope: ScopeRef, level: ItemLevel, name: string): Promise<void> {
    const params = new URLSearchParams({ org: scope.org, level, name });
    if (scope.repo) params.set('repo', scope.repo);
    if (scope.env) params.set('env', scope.env);

    await firstValueFrom(
      this.http.delete(`${environment.backendApiBaseUrl}/api/ledger/secrets?${params.toString()}`),
    );
  }
}
