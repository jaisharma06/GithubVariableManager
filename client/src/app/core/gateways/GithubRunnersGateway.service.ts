import { Injectable, inject } from '@angular/core';
import type { Runner } from '../Types';
import { GithubHttp } from './GithubHttp.service';
import type { IRunnersGateway } from './IRunnersGateway';

interface RawRunnersResponse {
  total_count: number;
  runners: Runner[];
}

/** Port of web/src/api/runners.ts. */
@Injectable({ providedIn: 'root' })
export class GithubRunnersGateway implements IRunnersGateway {
  private readonly http = inject(GithubHttp);

  async ListRepoRunners(owner: string, repo: string): Promise<Runner[]> {
    const data = await this.http.Get<RawRunnersResponse>(`/repos/${owner}/${repo}/actions/runners?per_page=100`);
    return data.runners;
  }

  async ListOrgRunners(org: string): Promise<Runner[]> {
    const data = await this.http.Get<RawRunnersResponse>(`/orgs/${org}/actions/runners?per_page=100`);
    return data.runners;
  }
}
