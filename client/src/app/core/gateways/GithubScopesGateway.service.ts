import { Injectable, inject } from '@angular/core';
import type { GithubOrg, GithubRepo, Viewer } from '../Types';
import { AuthTokenOverrideContext, GithubHttp } from './GithubHttp.service';
import { PaginateArray } from './GithubPagination';
import type { IScopesGateway } from './IScopesGateway';

interface RawRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
}

function ToRepo(r: RawRepo): GithubRepo {
  return { id: r.id, name: r.name, fullName: r.full_name, owner: r.owner.login, private: r.private };
}

/** Port of web/src/api/scopes.ts. */
@Injectable({ providedIn: 'root' })
export class GithubScopesGateway implements IScopesGateway {
  private readonly http = inject(GithubHttp);

  async GetViewer(token: string): Promise<Viewer> {
    const data = await this.http.Get<{ login: string; avatar_url: string }>('/user', AuthTokenOverrideContext(token));
    return { login: data.login, avatarUrl: data.avatar_url };
  }

  async ListMyOrgs(): Promise<GithubOrg[]> {
    const data = await this.http.Get<{ login: string; avatar_url: string }[]>('/user/orgs?per_page=100');
    return data.map((o) => ({ login: o.login, avatarUrl: o.avatar_url }));
  }

  async ListMyRepos(): Promise<GithubRepo[]> {
    const data = await this.http.Get<RawRepo[]>(
      '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
    );
    return data.map(ToRepo);
  }

  async ListOrgRepos(org: string): Promise<GithubRepo[]> {
    const data = await PaginateArray<RawRepo>((page) =>
      this.http.Get<RawRepo[]>(`/orgs/${org}/repos?per_page=100&page=${page}`),
    );
    return data.map(ToRepo);
  }

  async GetAccountType(login: string): Promise<'User' | 'Organization'> {
    const data = await this.http.Get<{ type: 'User' | 'Organization' }>(`/users/${login}`);
    return data.type;
  }
}
