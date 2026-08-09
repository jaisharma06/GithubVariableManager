import { Injectable, inject } from '@angular/core';
import { injectMutation, injectQuery, injectQueryClient } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/AuthService';
import { WORKFLOWS_GATEWAY, type IWorkflowsGateway } from '../gateways/IWorkflowsGateway';
import type { WorkflowRun } from '../Types';

const RUNS_DISPLAY_PAGE_SIZE = 30;
/** How often to re-poll an in-flight bulk-run-delete job — see DeleteRuns's doc comment. */
const WORKFLOW_CLEANUP_POLL_INTERVAL_MS = 500;
/** How often to re-poll a workflow's run list while any displayed run is still in flight — see WorkflowRunsQuery's doc comment. */
const WORKFLOW_RUNS_POLL_INTERVAL_MS = 5_000;

interface DeleteWorkflowRunParams {
  org: string;
  repo: string;
  workflowId: number;
  runId: number;
}

export interface DeleteRunsResult {
  succeededIds: number[];
  failedIds: number[];
  /** True if the backend reports at least one failed delete was a permission problem, not a fluke. */
  permissionDenied: boolean;
}

function Delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True once every displayed run has reached a terminal status — nothing left to poll for. */
export function AllRunsSettled(runs: WorkflowRun[] | undefined): boolean {
  return !runs || runs.every((r) => r.status === 'completed');
}

/**
 * Facade over IWorkflowsGateway — lists workflows and a workflow's runs, deletes a single run, and
 * bulk-deletes a caller-chosen set of a workflow's runs (cleanup). Kept as one facade rather than
 * splitting the bulk-delete into its own: nothing else in the app reuses a single-run-delete
 * mutation the way CopyFacade/DeleteEverywhereFacade reuse ItemMutationsFacade's mutations, so
 * there's no shared building block a second facade would exist to compose. WorkflowRunsQuery polls
 * conditionally — every 5s while any displayed run is still in flight (`status !== 'completed'`),
 * and not at all once everything visible has settled — a run has a real terminal state (unlike a
 * runner's online/offline/busy status, which never settles), so polling after settlement would just
 * be pointless API calls. WorkflowsQuery (the workflow list itself) is never polled: it only changes
 * when someone edits a `.yml` file, not something worth watching in the background.
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
    // Explicit generic argument: TQueryFnData can't be inferred purely from queryFn's return type
    // once refetchInterval's callback parameter (typed in terms of TQueryFnData) is also present —
    // without it, TS falls back to `unknown` for the whole options object.
    return injectQuery<WorkflowRun[]>(() => ({
      queryKey: ['workflow-runs', this.authService.token(), org(), repo(), workflowId()],
      queryFn: () => this.workflowsGateway.ListWorkflowRuns(org(), repo(), workflowId()!, RUNS_DISPLAY_PAGE_SIZE),
      enabled: !!this.authService.token() && workflowId() !== null,
      refetchInterval: (query) => (AllRunsSettled(query.state.data) ? false : WORKFLOW_RUNS_POLL_INTERVAL_MS),
    }));
  }

  readonly deleteWorkflowRun = injectMutation(() => ({
    mutationFn: (p: DeleteWorkflowRunParams) => this.workflowsGateway.DeleteWorkflowRun(p.org, p.repo, p.runId),
    onSuccess: (_data, p) => {
      this.queryClient.invalidateQueries({ queryKey: ['workflow-runs', this.authService.token(), p.org, p.repo, p.workflowId] });
    },
  }));

  /**
   * Deletes a caller-chosen set of a workflow's runs. As of Phase 5, the chunked one-call-per-run
   * fan-out (GitHub has no bulk-delete-runs endpoint) moved server-side
   * (`api/Services/WorkflowRunCleanupService.cs`) — this is now just a start+poll loop: kick off the
   * job, then poll until the backend reports it complete, forwarding each poll's `done`/`total` to
   * `onProgress` so the dialog can still show live incremental progress.
   */
  async DeleteRuns(
    org: string,
    repo: string,
    workflowId: number,
    runIds: number[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<DeleteRunsResult> {
    const jobId = await this.workflowsGateway.StartRunCleanup(org, repo, workflowId, runIds);
    let progress = await this.workflowsGateway.PollRunCleanup(jobId);
    onProgress?.(progress.done, progress.total);
    while (!progress.completed) {
      await Delay(WORKFLOW_CLEANUP_POLL_INTERVAL_MS);
      progress = await this.workflowsGateway.PollRunCleanup(jobId);
      onProgress?.(progress.done, progress.total);
    }

    const token = this.authService.token();
    this.queryClient.invalidateQueries({ queryKey: ['workflow-runs', token, org, repo, workflowId] });
    this.queryClient.invalidateQueries({ queryKey: ['workflows', token, org, repo] });

    return { succeededIds: progress.succeededIds, failedIds: progress.failedIds, permissionDenied: progress.permissionDenied };
  }
}
