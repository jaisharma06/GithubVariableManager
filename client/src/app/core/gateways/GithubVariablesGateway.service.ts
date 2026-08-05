import { Injectable, inject } from '@angular/core';
import type { ItemLevel, LedgerItem, ScopeRef } from '../Types';
import { GithubHttp } from './GithubHttp.service';
import { Paginate } from './GithubPagination';
import { ItemId, VariablesPath } from './GithubPathBuilder';
import type { IVariablesGateway } from './IVariablesGateway';

interface RawVariable {
  name: string;
  value: string;
  created_at: string;
  updated_at: string;
}

/** Port of web/src/api/variables.ts. */
@Injectable({ providedIn: 'root' })
export class GithubVariablesGateway implements IVariablesGateway {
  private readonly http = inject(GithubHttp);

  async ListVariables(scope: ScopeRef, level: ItemLevel): Promise<LedgerItem[]> {
    const items = await Paginate<RawVariable>(async (page) => {
      const data = await this.http.Get<{ total_count: number; variables: RawVariable[] }>(
        `${VariablesPath(scope, level)}?per_page=100&page=${page}`,
      );
      return { totalCount: data.total_count, items: data.variables };
    });

    return items.map((v) => ({
      id: ItemId('variable', level, scope, v.name),
      kind: 'variable' as const,
      level,
      scope,
      name: v.name,
      value: v.value,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
    }));
  }

  async CreateVariable(scope: ScopeRef, level: ItemLevel, name: string, value: string): Promise<void> {
    await this.http.Post(VariablesPath(scope, level), { name, value });
  }

  async UpdateVariable(
    scope: ScopeRef,
    level: ItemLevel,
    currentName: string,
    newName: string,
    value: string,
  ): Promise<void> {
    await this.http.Patch(`${VariablesPath(scope, level)}/${encodeURIComponent(currentName)}`, {
      name: newName,
      value,
    });
  }

  async DeleteVariable(scope: ScopeRef, level: ItemLevel, name: string): Promise<void> {
    await this.http.Delete(`${VariablesPath(scope, level)}/${encodeURIComponent(name)}`);
  }
}
