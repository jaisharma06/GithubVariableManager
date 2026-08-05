import { InjectionToken } from '@angular/core';
import type { GithubWorkflow, WorkflowRun } from '../Types';

/**
 * GitHub Actions workflows + their runs. No bulk-delete endpoint exists on GitHub's side — clearing
 * a caller-chosen set of a workflow's runs is one `DeleteWorkflowRun` call per run id.
 */
export interface IWorkflowsGateway {
  ListWorkflows(owner: string, repo: string): Promise<GithubWorkflow[]>;
  /** A single page of the most recent runs, newest first — for display and for selection. */
  ListWorkflowRuns(owner: string, repo: string, workflowId: number, perPage: number): Promise<WorkflowRun[]>;
  DeleteWorkflowRun(owner: string, repo: string, runId: number): Promise<void>;
}

export const WORKFLOWS_GATEWAY = new InjectionToken<IWorkflowsGateway>('WORKFLOWS_GATEWAY');
