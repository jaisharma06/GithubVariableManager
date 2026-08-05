import { Injectable, inject } from '@angular/core';
import type { GithubWorkflow, WorkflowRun } from '../Types';
import { GithubHttp } from './GithubHttp.service';
import { Paginate } from './GithubPagination';
import type { IWorkflowsGateway } from './IWorkflowsGateway';

interface RawWorkflow {
  id: number;
  name: string;
  path: string;
  state: GithubWorkflow['state'];
}

interface RawWorkflowRun {
  id: number;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  run_number: number;
  created_at: string;
  updated_at: string;
  html_url: string;
}

function ToWorkflowRun(raw: RawWorkflowRun): WorkflowRun {
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    conclusion: raw.conclusion,
    runNumber: raw.run_number,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    htmlUrl: raw.html_url,
  };
}

/**
 * Actions workflows + runs. GitHub exposes no bulk-delete-runs endpoint, so `DeleteWorkflowRun`
 * is one call per run — WorkflowsFacade.DeleteRuns is what fans that out.
 */
@Injectable({ providedIn: 'root' })
export class GithubWorkflowsGateway implements IWorkflowsGateway {
  private readonly http = inject(GithubHttp);

  async ListWorkflows(owner: string, repo: string): Promise<GithubWorkflow[]> {
    const workflows = await Paginate<RawWorkflow>(async (page) => {
      const data = await this.http.Get<{ total_count: number; workflows: RawWorkflow[] }>(
        `/repos/${owner}/${repo}/actions/workflows?per_page=100&page=${page}`,
      );
      return { totalCount: data.total_count, items: data.workflows };
    });

    return workflows.map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state }));
  }

  async ListWorkflowRuns(owner: string, repo: string, workflowId: number, perPage: number): Promise<WorkflowRun[]> {
    const data = await this.http.Get<{ total_count: number; workflow_runs: RawWorkflowRun[] }>(
      `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?per_page=${perPage}`,
    );
    return data.workflow_runs.map(ToWorkflowRun);
  }

  async DeleteWorkflowRun(owner: string, repo: string, runId: number): Promise<void> {
    await this.http.Delete(`/repos/${owner}/${repo}/actions/runs/${runId}`);
  }
}
