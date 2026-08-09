import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { Runner } from '../Types';
import { GitHubApiError } from './GitHubApiError';
import type { IRunnersGateway } from './IRunnersGateway';

/**
 * Talks to the `api/` ASP.NET Core backend's Runners vertical (`Endpoints/RunnersEndpoints.cs`)
 * rather than api.github.com directly (Phase 4). Injects `HttpClient` directly — mirrors
 * `BackendScopesGateway`/`BackendEnvironmentsGateway`'s shape exactly (no GitHub
 * Accept/API-Version headers needed, `AuthInterceptor`'s ambient `Authorization: Bearer`
 * attachment covers every call here). Unlike those two, this Gateway needs its own
 * `HttpErrorResponse` -> `GitHubApiError` conversion (`ToBackendRunnersError` below) — every other
 * Backend gateway either doesn't classify permission errors on the client at all, or (per
 * `GitHubApiError.ts`'s constructor default) recomputes `locked` from `status`. This Gateway
 * instead reads `locked` straight off the backend's parsed response body
 * (`{ locked, status, message }`, per `Auth/PermissionErrorClassifier.cs`'s wire shape), so
 * `RunnersPanel.component.ts`'s `noAccess` computed reflects the backend's actual classification
 * rather than recomputing it. Kept inlined here rather than extracted into a shared helper —
 * Runners is only the first Backend gateway that needs this (rule of three, see
 * `ScopesEndpoints.cs`'s own doc comment for the precedent).
 */
@Injectable({ providedIn: 'root' })
export class BackendRunnersGateway implements IRunnersGateway {
  private readonly http = inject(HttpClient);

  async ListRunners(org: string, repo?: string): Promise<Runner[]> {
    const params = new URLSearchParams({ org, ...(repo ? { repo } : {}) });
    try {
      return await firstValueFrom(
        this.http.get<Runner[]>(`${environment.backendApiBaseUrl}/api/runners?${params.toString()}`),
      );
    } catch (err) {
      throw ToBackendRunnersError(err);
    }
  }
}

function ToBackendRunnersError(err: unknown): GitHubApiError {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { locked?: boolean; message?: string } | null;
    return new GitHubApiError(body?.message ?? `GitHub API error (${err.status})`, err.status, body?.locked);
  }
  return new GitHubApiError(err instanceof Error ? err.message : 'Unknown error', 0);
}
