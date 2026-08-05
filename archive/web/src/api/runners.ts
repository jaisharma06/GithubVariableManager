import { githubFetch } from './client'

export interface RunnerLabel {
  id: number
  name: string
  type: string
}

export interface Runner {
  id: number
  name: string
  os: string
  status: 'online' | 'offline'
  busy: boolean
  labels: RunnerLabel[]
}

interface RawRunnersResponse {
  total_count: number
  runners: Runner[]
}

/** Self-hosted runners assigned directly to this repo. */
export async function listRepoRunners(token: string, owner: string, repo: string): Promise<Runner[]> {
  const data = await githubFetch<RawRunnersResponse>(token, `/repos/${owner}/${repo}/actions/runners?per_page=100`)
  return data.runners
}

/** Self-hosted runners at the organization level. */
export async function listOrgRunners(token: string, org: string): Promise<Runner[]> {
  const data = await githubFetch<RawRunnersResponse>(token, `/orgs/${org}/actions/runners?per_page=100`)
  return data.runners
}
