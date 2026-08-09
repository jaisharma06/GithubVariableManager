import { InjectionToken } from '@angular/core';
import type { GithubWorkflow, WorkflowRun, WorkflowRunDetail } from '../Types';

/** Progress of an in-flight bulk-run-delete job — see `StartRunCleanup`/`PollRunCleanup` below. */
export interface WorkflowRunCleanupProgress {
  done: number;
  total: number;
  completed: boolean;
  succeededIds: number[];
  failedIds: number[];
  permissionDenied: boolean;
}

/**
 * GitHub Actions workflows + their runs. No bulk-delete endpoint exists on GitHub's side, but as of
 * Phase 5 the client no longer fans that out itself: `StartRunCleanup`/`PollRunCleanup` are a
 * start+poll pair against `api/`'s Workflows vertical, which does the one-call-per-run chunking
 * server-side (`Services/WorkflowRunCleanupService.cs`) and reports progress across separate polls.
 */
export interface IWorkflowsGateway {
  ListWorkflows(owner: string, repo: string): Promise<GithubWorkflow[]>;
  /** A single page of the most recent runs, newest first — for display and for selection. */
  ListWorkflowRuns(owner: string, repo: string, workflowId: number, perPage: number): Promise<WorkflowRun[]>;
  DeleteWorkflowRun(owner: string, repo: string, runId: number): Promise<void>;
  /** One run's full detail, including every job and its steps (fully paginated server-side). */
  GetWorkflowRunDetail(owner: string, repo: string, runId: number): Promise<WorkflowRunDetail>;
  RerunWorkflowRun(owner: string, repo: string, runId: number): Promise<void>;
  /** Kicks off a bulk-run-delete job server-side; returns the job id to poll for progress. */
  StartRunCleanup(owner: string, repo: string, workflowId: number, runIds: number[]): Promise<string>;
  /** Polls an in-flight bulk-run-delete job's progress. */
  PollRunCleanup(jobId: string): Promise<WorkflowRunCleanupProgress>;
}

export const WORKFLOWS_GATEWAY = new InjectionToken<IWorkflowsGateway>('WORKFLOWS_GATEWAY');
