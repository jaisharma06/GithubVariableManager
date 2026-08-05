import { GitHubApiError, githubFetch } from './client'
import type { GithubEnvironment } from './types'

export async function listEnvironments(token: string, owner: string, repo: string): Promise<GithubEnvironment[]> {
  try {
    const data = await githubFetch<{ total_count: number; environments?: { name: string; id: number }[] }>(
      token,
      `/repos/${owner}/${repo}/environments?per_page=100`,
    )
    return (data.environments ?? []).map((e) => ({ name: e.name, id: e.id }))
  } catch (err) {
    // Repos without any configured environments (or on plans without env support) 404 here.
    if (err instanceof GitHubApiError && err.status === 404) return []
    throw err
  }
}

/** Creates the environment if it doesn't exist yet (GitHub's PUT is create-or-update). */
export async function createEnvironment(token: string, owner: string, repo: string, name: string): Promise<void> {
  await githubFetch(token, `/repos/${owner}/${repo}/environments/${encodeURIComponent(name)}`, {
    method: 'PUT',
  })
}

export async function deleteEnvironment(token: string, owner: string, repo: string, name: string): Promise<void> {
  await githubFetch(token, `/repos/${owner}/${repo}/environments/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}
