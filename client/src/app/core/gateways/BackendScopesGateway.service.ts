import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { GithubOrg, GithubRepo } from '../Types';
import type { IScopesGateway } from './IScopesGateway';

/**
 * Talks to the `api/` ASP.NET Core backend's Scopes vertical (`Endpoints/ScopesEndpoints.cs`)
 * rather than api.github.com directly. Injects `HttpClient` directly — these
 * aren't api.github.com calls, so they don't need GitHub's Accept/API-Version headers. Unlike
 * `BackendOAuthGateway`'s `GetViewer`, no `AUTH_TOKEN_OVERRIDE` is needed here — every
 * `IScopesGateway` call runs with an active session, so `AuthInterceptor`'s ambient
 * `Authorization: Bearer` attachment covers it automatically.
 */
@Injectable({ providedIn: 'root' })
export class BackendScopesGateway implements IScopesGateway {
  private readonly http = inject(HttpClient);

  async ListMyOrgs(): Promise<GithubOrg[]> {
    return firstValueFrom(this.http.get<GithubOrg[]>(`${environment.backendApiBaseUrl}/api/scopes/orgs`));
  }

  async ListMyRepos(): Promise<GithubRepo[]> {
    return firstValueFrom(this.http.get<GithubRepo[]>(`${environment.backendApiBaseUrl}/api/scopes/repos`));
  }

  async ListOrgRepos(org: string): Promise<GithubRepo[]> {
    return firstValueFrom(this.http.get<GithubRepo[]>(`${environment.backendApiBaseUrl}/api/scopes/orgs/${org}/repos`));
  }

  async GetAccountType(login: string): Promise<'User' | 'Organization'> {
    const data = await firstValueFrom(
      this.http.get<{ type: 'User' | 'Organization' }>(
        `${environment.backendApiBaseUrl}/api/scopes/accounts/${login}/type`,
      ),
    );
    return data.type;
  }
}
