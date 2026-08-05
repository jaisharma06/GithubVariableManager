import { Injectable, inject } from '@angular/core';
import { injectMutation, injectQuery, injectQueryClient } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/AuthService';
import { GitHubApiError } from '../gateways/GitHubApiError';
import { WORKFLOWS_GATEWAY, type IWorkflowsGateway } from '../gateways/IWorkflowsGateway';

const RUNS_DISPLAY_PAGE_SIZE = 30;
/** Runs deleted per chunk before moving to the next — see DeleteRuns's doc comment. */
const DELETE_CHUNK_SIZE = 5;

interface DeleteWorkflowRunParams {
  org: string;
  repo: string;
  workflowId: number;
  runId: number;
}

export interface DeleteRunsResult {
  succeededIds: number[];
  failedIds: number[];
  /** True if at least one failed delete was a 403 — a repo-write-access problem, not a fluke. */
  permissionDenied: boolean;
}

/**
 * Facade over IWorkflowsGateway — lists workflows and a workflow's runs, deletes a single run, and
 * bulk-deletes a caller-chosen set of a workflow's runs (cleanup). Kept as one facade rather than
 * splitting the bulk-delete into its own: nothing else in the app reuses a single-run-delete
 * mutation the way CopyFacade/DeleteEverywhereFacade reuse ItemMutationsFacade's mutations, so
 * there's no shared building block a second facade would exist to compose.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowsFacade {
  private readonly workflowsGateway = inject<IWorkflowsGateway>(WORKFLOWS_GATEWAY);
  private readonly authService = inject(AuthService);
  private readonly queryClient = injectQueryClient();

  WorkflowsQuery(org: () => string, repo: () => string | undefined) {
    return injectQuery(() => ({
      queryKey: ['workflows', this.authService.token(), org(), repo()],
      queryFn: () => this.workflowsGateway.ListWorkflows(org(), repo()!),
      enabled: !!this.authService.token() && !!repo(),
    }));
  }

  WorkflowRunsQuery(org: () => string, repo: () => string, workflowId: () => number | null) {
    return injectQuery(() => ({
      queryKey: ['workflow-runs', this.authService.token(), org(), repo(), workflowId()],
      queryFn: () => this.workflowsGateway.ListWorkflowRuns(org(), repo(), workflowId()!, RUNS_DISPLAY_PAGE_SIZE),
      enabled: !!this.authService.token() && workflowId() !== null,
    }));
  }

  readonly deleteWorkflowRun = injectMutation(() => ({
    mutationFn: (p: DeleteWorkflowRunParams) => this.workflowsGateway.DeleteWorkflowRun(p.org, p.repo, p.runId),
    onSuccess: (_data, p) => {
      this.queryClient.invalidateQueries({ queryKey: ['workflow-runs', this.authService.token(), p.org, p.repo, p.workflowId] });
    },
  }));

  /**
   * Deletes a caller-chosen set of a workflow's runs — GitHub has no bulk-delete-runs endpoint, so
   * this is one `DELETE` per run id. Unlike CopyFacade/DeleteEverywhereFacade (which fire every
   * target at once via a single `Promise.allSettled`, safe because their targets are bounded by
   * environment count), a selection here can still be dozens of runs: firing that many requests
   * simultaneously risks tripping GitHub's secondary rate limiting, and a caller has no visibility
   * into progress until everything either finishes or fails together. Deleting in small,
   * sequentially-processed chunks (`Promise.allSettled` *within* a chunk, so one failing delete
   * doesn't abort the rest of that chunk — same partial-failure convention as this codebase's other
   * batch facades) bounds concurrent load and lets `onProgress` report real incremental progress.
   */
  async DeleteRuns(
    org: string,
    repo: string,
    workflowId: number,
    runIds: number[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<DeleteRunsResult> {
    const total = runIds.length;
    const succeededIds: number[] = [];
    const failedIds: number[] = [];
    let permissionDenied = false;

    for (let i = 0; i < runIds.length; i += DELETE_CHUNK_SIZE) {
      const chunk = runIds.slice(i, i + DELETE_CHUNK_SIZE);
      const settled = await Promise.allSettled(chunk.map((runId) => this.workflowsGateway.DeleteWorkflowRun(org, repo, runId)));
      settled.forEach((result, index) => {
        const runId = chunk[index];
        if (result.status === 'fulfilled') {
          succeededIds.push(runId);
        } else {
          failedIds.push(runId);
          if (result.reason instanceof GitHubApiError && result.reason.status === 403) permissionDenied = true;
        }
      });
      onProgress?.(succeededIds.length + failedIds.length, total);
    }

    const token = this.authService.token();
    this.queryClient.invalidateQueries({ queryKey: ['workflow-runs', token, org, repo, workflowId] });
    this.queryClient.invalidateQueries({ queryKey: ['workflows', token, org, repo] });

    return { succeededIds, failedIds, permissionDenied };
  }
}
