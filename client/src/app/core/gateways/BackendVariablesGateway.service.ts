import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { ItemLevel, ScopeRef } from '../Types';
import type { IVariablesGateway } from './IVariablesGateway';

/**
 * Talks to the `api/` ASP.NET Core backend's Ledger vertical (`Endpoints/LedgerEndpoints.cs`)
 * rather than api.github.com directly. Injects `HttpClient` directly — mirrors
 * `BackendScopesGateway.service.ts`'s shape exactly (no GitHub Accept/API-Version headers needed;
 * `AuthInterceptor`'s ambient `Authorization: Bearer` attachment covers every call here).
 */
@Injectable({ providedIn: 'root' })
export class BackendVariablesGateway implements IVariablesGateway {
  private readonly http = inject(HttpClient);

  async CreateVariable(scope: ScopeRef, level: ItemLevel, name: string, value: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.backendApiBaseUrl}/api/ledger/variables`, {
        org: scope.org,
        repo: scope.repo,
        env: scope.env,
        level,
        name,
        value,
      }),
    );
  }

  async UpdateVariable(
    scope: ScopeRef,
    level: ItemLevel,
    currentName: string,
    newName: string,
    value: string,
  ): Promise<void> {
    await firstValueFrom(
      this.http.patch(`${environment.backendApiBaseUrl}/api/ledger/variables`, {
        org: scope.org,
        repo: scope.repo,
        env: scope.env,
        level,
        currentName,
        newName,
        value,
      }),
    );
  }

  async DeleteVariable(scope: ScopeRef, level: ItemLevel, name: string): Promise<void> {
    const params = new URLSearchParams({ org: scope.org, level, name });
    if (scope.repo) params.set('repo', scope.repo);
    if (scope.env) params.set('env', scope.env);

    await firstValueFrom(
      this.http.delete(`${environment.backendApiBaseUrl}/api/ledger/variables?${params.toString()}`),
    );
  }
}
