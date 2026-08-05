import { githubFetch, paginateArray } from './client'
import type { GithubOrg, GithubRepo, Viewer } from './types'

export async function getViewer(token: string): Promise<Viewer> {
  const data = await githubFetch<{ login: string; avatar_url: string }>(token, '/user')
  return { login: data.login, avatarUrl: data.avatar_url }
}

export async function listMyOrgs(token: string): Promise<GithubOrg[]> {
  const data = await githubFetch<{ login: string; avatar_url: string }[]>(token, '/user/orgs?per_page=100')
  return data.map((o) => ({ login: o.login, avatarUrl: o.avatar_url }))
}

/**
 * Org-level Actions variables/secrets only exist for real Organization accounts — a repo owned
 * by a personal User account has no such thing, and GitHub 404s /orgs/{login}/... for one.
 */
export async function getAccountType(token: string, login: string): Promise<'User' | 'Organization'> {
  const data = await githubFetch<{ type: 'User' | 'Organization' }>(token, `/users/${login}`)
  return data.type
}

interface RawRepo {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  private: boolean
}

function toRepo(r: RawRepo): GithubRepo {
  return { id: r.id, name: r.name, fullName: r.full_name, owner: r.owner.login, private: r.private }
}

export async function listMyRepos(token: string): Promise<GithubRepo[]> {
  const data = await githubFetch<RawRepo[]>(
    token,
    '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
  )
  return data.map(toRepo)
}

/** All repos in an org — used for the "selected repositories" secret-visibility picker. */
export async function listOrgRepos(token: string, org: string): Promise<GithubRepo[]> {
  const data = await paginateArray<RawRepo>((page) =>
    githubFetch<RawRepo[]>(token, `/orgs/${org}/repos?per_page=100&page=${page}`),
  )
  return data.map(toRepo)
}
