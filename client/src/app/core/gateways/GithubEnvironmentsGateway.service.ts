import { Injectable, inject } from '@angular/core';
import type { GithubEnvironment } from '../Types';
import { GitHubApiError } from './GitHubApiError';
import { GithubHttp } from './GithubHttp.service';
import type { IEnvironmentsGateway } from './IEnvironmentsGateway';

/** Port of web/src/api/environments.ts. */
@Injectable({ providedIn: 'root' })
export class GithubEnvironmentsGateway implements IEnvironmentsGateway {
  private readonly http = inject(GithubHttp);

  async ListEnvironments(owner: string, repo: string): Promise<GithubEnvironment[]> {
    try {
      const data = await this.http.Get<{ total_count: number; environments?: { name: string; id: number }[] }>(
        `/repos/${owner}/${repo}/environments?per_page=100`,
      );
      return (data.environments ?? []).map((e) => ({ name: e.name, id: e.id }));
    } catch (err) {
      // Repos without any configured environments (or on plans without env support) 404 here.
      if (err instanceof GitHubApiError && err.status === 404) return [];
      throw err;
    }
  }

  async CreateEnvironment(owner: string, repo: string, name: string): Promise<void> {
    await this.http.Put(`/repos/${owner}/${repo}/environments/${encodeURIComponent(name)}`);
  }

  async DeleteEnvironment(owner: string, repo: string, name: string): Promise<void> {
    await this.http.Delete(`/repos/${owner}/${repo}/environments/${encodeURIComponent(name)}`);
  }
}
