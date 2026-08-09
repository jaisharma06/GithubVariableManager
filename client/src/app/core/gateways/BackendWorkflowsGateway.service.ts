import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { GithubWorkflow, WorkflowRun } from '../Types';
import { GitHubApiError } from './GitHubApiError';
import type { IWorkflowsGateway, WorkflowRunCleanupProgress } from './IWorkflowsGateway';

/**
 * Talks to the `api/` ASP.NET Core backend's Workflows vertical (`Endpoints/WorkflowsEndpoints.cs`)
 * rather than api.github.com directly (Phase 5). Injects `HttpClient` directly —
 * mirrors `BackendRunnersGateway`'s shape exactly, including its own local `HttpErrorResponse` ->
 * `GitHubApiError` conversion (`ToBackendWorkflowsError` below) that reads `locked` straight off the
 * backend's parsed `{ locked, status, message }` response body rather than recomputing it from
 * `status` — see `RunnersPanel.component.ts`'s `noAccess` precedent, mirrored here by
 * `WorkflowsView.component.ts`'s `PermissionAwareMessage`. Backend field names already match this
 * app's `GithubWorkflow`/`WorkflowRun` domain types (`JsonSerializerDefaults.Web` camelCases
 * `WorkflowResponse`/`WorkflowRunResponse`), so unlike the old `GithubWorkflowsGateway`, no
 * raw-to-domain mapping is needed here.
 */
@Injectable({ providedIn: 'root' })
export class BackendWorkflowsGateway implements IWorkflowsGateway {
  private readonly http = inject(HttpClient);

  async ListWorkflows(owner: string, repo: string): Promise<GithubWorkflow[]> {
    const params = new URLSearchParams({ org: owner, repo });
    try {
      return await firstValueFrom(
        this.http.get<GithubWorkflow[]>(`${environment.backendApiBaseUrl}/api/workflows?${params.toString()}`),
      );
    } catch (err) {
      throw ToBackendWorkflowsError(err);
    }
  }

  async ListWorkflowRuns(owner: string, repo: string, workflowId: number, perPage: number): Promise<WorkflowRun[]> {
    const params = new URLSearchParams({ org: owner, repo, workflowId: String(workflowId), perPage: String(perPage) });
    try {
      return await firstValueFrom(
        this.http.get<WorkflowRun[]>(`${environment.backendApiBaseUrl}/api/workflows/runs?${params.toString()}`),
      );
    } catch (err) {
      throw ToBackendWorkflowsError(err);
    }
  }

  async DeleteWorkflowRun(owner: string, repo: string, runId: number): Promise<void> {
    const params = new URLSearchParams({ org: owner, repo, runId: String(runId) });
    try {
      await firstValueFrom(
        this.http.delete<void>(`${environment.backendApiBaseUrl}/api/workflows/runs?${params.toString()}`),
      );
    } catch (err) {
      throw ToBackendWorkflowsError(err);
    }
  }

  async StartRunCleanup(owner: string, repo: string, workflowId: number, runIds: number[]): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ jobId: string }>(`${environment.backendApiBaseUrl}/api/workflows/runs/cleanup`, {
          org: owner,
          repo,
          workflowId,
          runIds,
        }),
      );
      return response.jobId;
    } catch (err) {
      throw ToBackendWorkflowsError(err);
    }
  }

  async PollRunCleanup(jobId: string): Promise<WorkflowRunCleanupProgress> {
    try {
      return await firstValueFrom(
        this.http.get<WorkflowRunCleanupProgress>(`${environment.backendApiBaseUrl}/api/workflows/runs/cleanup/${jobId}`),
      );
    } catch (err) {
      throw ToBackendWorkflowsError(err);
    }
  }
}

function ToBackendWorkflowsError(err: unknown): GitHubApiError {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { locked?: boolean; message?: string } | null;
    return new GitHubApiError(body?.message ?? `GitHub API error (${err.status})`, err.status, body?.locked);
  }
  return new GitHubApiError(err instanceof Error ? err.message : 'Unknown error', 0);
}
