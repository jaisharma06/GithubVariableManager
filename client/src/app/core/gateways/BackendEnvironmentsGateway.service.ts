import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { GithubEnvironment } from '../Types';
import type { IEnvironmentsGateway, RenameEnvironmentParams, RenameEnvironmentResult } from './IEnvironmentsGateway';

/**
 * Talks to the `api/` ASP.NET Core backend's Ledger vertical (`Endpoints/LedgerEndpoints.cs`)
 * rather than api.github.com directly — mirrors `BackendVariablesGateway.service.ts`'s shape
 * exactly (injects `HttpClient` directly; no GitHub Accept/API-Version headers
 * needed, `AuthInterceptor`'s ambient `Authorization: Bearer` attachment covers every call here).
 * `RenameEnvironment` (Phase 3c) replaces the old client-side create-then-copy-then-delete
 * sequence with one backend call — see `IEnvironmentsGateway.ts`'s doc comment.
 */
@Injectable({ providedIn: 'root' })
export class BackendEnvironmentsGateway implements IEnvironmentsGateway {
  private readonly http = inject(HttpClient);

  async ListEnvironments(org: string, repo: string): Promise<GithubEnvironment[]> {
    const params = new URLSearchParams({ org, repo });
    return firstValueFrom(
      this.http.get<GithubEnvironment[]>(`${environment.backendApiBaseUrl}/api/ledger/environments?${params.toString()}`),
    );
  }

  async CreateEnvironment(org: string, repo: string, name: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.backendApiBaseUrl}/api/ledger/environments`, { org, repo, name }),
    );
  }

  async DeleteEnvironment(org: string, repo: string, name: string): Promise<void> {
    const params = new URLSearchParams({ org, repo, name });
    await firstValueFrom(
      this.http.delete(`${environment.backendApiBaseUrl}/api/ledger/environments?${params.toString()}`),
    );
  }

  async RenameEnvironment(params: RenameEnvironmentParams): Promise<RenameEnvironmentResult> {
    return firstValueFrom(
      this.http.post<RenameEnvironmentResult>(`${environment.backendApiBaseUrl}/api/ledger/environments/rename`, {
        org: params.org,
        repo: params.repo,
        oldName: params.oldName,
        newName: params.newName,
        deleteOldAnyway: params.deleteOldAnyway,
      }),
    );
  }
}
