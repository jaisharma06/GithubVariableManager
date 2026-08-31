import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { ItemKind, ItemLevel, LedgerItem, ScopeRef } from '../Types';
import type {
  CopyResult,
  CopyTarget,
  DeleteEverywhereResult,
  DeleteEverywhereTarget,
  EnvironmentVariableCopyResult,
} from '../facades/CopySupport';
import type { LedgerLockedSection, LedgerPartialError, LedgerResult } from '../facades/LedgerSupport';
import { ItemId } from './GithubPathBuilder';
import type { ILedgerGateway, ResolveVariableResult } from './ILedgerGateway';
import type { PutSecretOptions } from './ISecretsGateway';

interface LedgerItemResponse {
  kind: ItemKind;
  level: ItemLevel;
  org: string;
  repo: string | null;
  env: string | null;
  name: string;
  value: string | null;
  visibility: LedgerItem['visibility'] | null;
  createdAt: string;
  updatedAt: string;
  resolvedValue: string | null;
  unresolvedReferences: string[] | null;
}

interface ResolveVariableRequest {
  org: string;
  repo?: string;
  env?: string;
  level: ItemLevel;
  name: string;
  value: string;
}

interface ResolveVariableResponse {
  resolvedValue: string | null;
  unresolvedReferences: string[];
  circular: boolean;
  circularError: string | null;
}

interface LedgerLockedSectionResponse {
  level: ItemLevel;
  kind: ItemKind;
  scopeLabel: string;
  env: string | null;
}

interface LedgerResponse {
  items: LedgerItemResponse[];
  partialErrors: LedgerPartialError[];
  lockedSections: LedgerLockedSectionResponse[];
}

interface LedgerScopeTargetRequest {
  org: string;
  repo?: string;
  env?: string;
  level: ItemLevel;
}

interface LedgerScopeTargetResponse {
  org: string;
  repo: string | null;
  env: string | null;
  level: ItemLevel;
}

interface CopyRequest {
  kind: ItemKind;
  name: string;
  value: string;
  visibility?: string;
  selectedRepositoryIds?: number[];
  targets: LedgerScopeTargetRequest[];
}

interface CopyTargetResultResponse {
  target: LedgerScopeTargetResponse;
  ok: boolean;
  message: string | null;
}

interface CopyResponse {
  results: CopyTargetResultResponse[];
}

interface DeleteEverywhereRequest {
  kind: ItemKind;
  name: string;
  targets: LedgerScopeTargetRequest[];
}

interface DeleteEverywhereTargetResultResponse {
  target: LedgerScopeTargetResponse;
  ok: boolean;
  message: string | null;
}

interface DeleteEverywhereResponse {
  results: DeleteEverywhereTargetResultResponse[];
}

interface CopyEnvironmentVariablesRequest {
  sourceOrg: string;
  sourceRepo: string;
  sourceEnv: string;
  destOrg: string;
  destRepo: string;
  destEnv: string;
}

interface VariableCopyFailureResponse {
  name: string;
  error: string;
}

interface CopyEnvironmentVariablesResponse {
  listSourceError: string | null;
  copied: string[];
  skipped: string[];
  failures: VariableCopyFailureResponse[];
}

/**
 * Talks to the `api/` ASP.NET Core backend's Ledger vertical (`Endpoints/LedgerEndpoints.cs`)
 * rather than api.github.com directly. Injects `HttpClient` directly — mirrors
 * `BackendScopesGateway.service.ts`'s shape exactly. `GithubPathBuilder.ts`'s `ItemId` stays the
 * single source of truth for the composite-key format — this Gateway just feeds it from the
 * backend's already-decided response instead of raw GitHub JSON.
 */
@Injectable({ providedIn: 'root' })
export class BackendLedgerGateway implements ILedgerGateway {
  private readonly http = inject(HttpClient);

  async GetLedger(org: string, repo?: string): Promise<LedgerResult> {
    const params = new URLSearchParams({ org });
    if (repo) params.set('repo', repo);

    const data = await firstValueFrom(
      this.http.get<LedgerResponse>(`${environment.backendApiBaseUrl}/api/ledger?${params.toString()}`),
    );

    return {
      items: data.items.map((i) => this.ToLedgerItem(i)),
      partialErrors: data.partialErrors,
      lockedSections: data.lockedSections.map((s) => this.ToLockedSection(s)),
    };
  }

  async Copy(
    kind: ItemKind,
    name: string,
    value: string,
    targets: CopyTarget[],
    options?: PutSecretOptions,
  ): Promise<CopyResult[]> {
    const request: CopyRequest = {
      kind,
      name,
      value,
      visibility: options?.visibility,
      selectedRepositoryIds: options?.selectedRepositoryIds,
      targets: targets.map((t) => this.ToTargetRequest(t.level, t.scope)),
    };

    const data = await firstValueFrom(
      this.http.post<CopyResponse>(`${environment.backendApiBaseUrl}/api/ledger/copy`, request),
    );

    return data.results.map((r, i) => ({ target: targets[i], ok: r.ok, message: r.message ?? undefined }));
  }

  async DeleteEverywhere(kind: ItemKind, name: string, targets: DeleteEverywhereTarget[]): Promise<DeleteEverywhereResult[]> {
    const request: DeleteEverywhereRequest = {
      kind,
      name,
      targets: targets.map((t) => this.ToTargetRequest(t.level, t.scope)),
    };

    const data = await firstValueFrom(
      this.http.post<DeleteEverywhereResponse>(`${environment.backendApiBaseUrl}/api/ledger/delete-everywhere`, request),
    );

    return data.results.map((r, i) => ({ target: targets[i], ok: r.ok, message: r.message ?? undefined }));
  }

  async ExportLedger(org: string, repo?: string): Promise<{ blob: Blob; filename: string }> {
    const params = new URLSearchParams({ org });
    if (repo) params.set('repo', repo);

    const response = await firstValueFrom(
      this.http.get(`${environment.backendApiBaseUrl}/api/ledger/export?${params.toString()}`, {
        responseType: 'blob',
        observe: 'response',
      }),
    );

    return { blob: response.body!, filename: this.FilenameFrom(response.headers.get('Content-Disposition'), org, repo) };
  }

  async CopyEnvironmentVariables(source: ScopeRef, dest: ScopeRef): Promise<EnvironmentVariableCopyResult> {
    const request: CopyEnvironmentVariablesRequest = {
      sourceOrg: source.org,
      sourceRepo: source.repo!,
      sourceEnv: source.env!,
      destOrg: dest.org,
      destRepo: dest.repo!,
      destEnv: dest.env!,
    };

    const data = await firstValueFrom(
      this.http.post<CopyEnvironmentVariablesResponse>(
        `${environment.backendApiBaseUrl}/api/ledger/environments/copy-variables`,
        request,
      ),
    );

    return {
      listSourceError: data.listSourceError ?? undefined,
      copied: data.copied,
      skipped: data.skipped,
      failures: data.failures.map((f) => ({ name: f.name, message: f.error })),
    };
  }

  async ResolveVariable(scope: ScopeRef, level: ItemLevel, name: string, value: string): Promise<ResolveVariableResult> {
    const request: ResolveVariableRequest = { org: scope.org, repo: scope.repo, env: scope.env, level, name, value };

    const data = await firstValueFrom(
      this.http.post<ResolveVariableResponse>(`${environment.backendApiBaseUrl}/api/ledger/variables/resolve`, request),
    );

    return {
      resolvedValue: data.resolvedValue ?? undefined,
      unresolvedReferences: data.unresolvedReferences,
      circular: data.circular,
      circularError: data.circularError ?? undefined,
    };
  }

  /**
   * Parses the filename out of the response's `Content-Disposition` header. Falls back to
   * recomputing it locally, in the same format the server builds it in, so a header-parsing edge
   * case never blocks the actual download.
   */
  private FilenameFrom(contentDisposition: string | null, org: string, repo?: string): string {
    const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
    if (match?.[1]) return match[1];

    const date = new Date().toISOString().slice(0, 10);
    return repo ? `${org}-${repo}-variables-secrets-${date}.xlsx` : `${org}-variables-secrets-${date}.xlsx`;
  }

  /** The reverse of `ToLedgerItem`'s scope extraction — flattens a `ScopeRef` into the wire shape's separate `org`/`repo`/`env` fields. */
  private ToTargetRequest(level: ItemLevel, scope: ScopeRef): LedgerScopeTargetRequest {
    return { org: scope.org, repo: scope.repo, env: scope.env, level };
  }

  private ToLedgerItem(item: LedgerItemResponse): LedgerItem {
    const scope: ScopeRef = { org: item.org, repo: item.repo ?? undefined, env: item.env ?? undefined };
    return {
      id: ItemId(item.kind, item.level, scope, item.name),
      kind: item.kind,
      level: item.level,
      scope,
      name: item.name,
      value: item.value ?? undefined,
      visibility: item.visibility ?? undefined,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      resolvedValue: item.resolvedValue ?? undefined,
      unresolvedReferences: item.unresolvedReferences ?? undefined,
    };
  }

  private ToLockedSection(section: LedgerLockedSectionResponse): LedgerLockedSection {
    return { level: section.level, kind: section.kind, scopeLabel: section.scopeLabel, env: section.env ?? undefined };
  }
}
