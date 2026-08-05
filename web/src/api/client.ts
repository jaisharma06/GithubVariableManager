import { setRateLimit } from '../lib/rateLimitStore'
import { notifyUnauthorized } from '../lib/authEvents'

const GITHUB_API = 'https://api.github.com'

export class GitHubApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function githubFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    // GitHub's list endpoints can send caching headers; without this, a browser can serve a
    // stale cached GET even right after a write we just made, making changes look like they
    // "didn't take" until the cache entry expires.
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  const remaining = res.headers.get('x-ratelimit-remaining')
  const limit = res.headers.get('x-ratelimit-limit')
  const reset = res.headers.get('x-ratelimit-reset')
  if (remaining !== null && limit !== null) {
    setRateLimit({
      remaining: Number(remaining),
      limit: Number(limit),
      resetAt: reset ? Number(reset) * 1000 : null,
    })
  }

  if (res.status === 204) {
    return undefined as T
  }

  if (!res.ok) {
    let message = `GitHub API error (${res.status})`
    try {
      const body = (await res.json()) as { message?: string }
      if (body?.message) message = body.message
    } catch {
      // response had no JSON body
    }
    // The stored token was revoked/expired server-side — clear the session so the
    // user lands back on /connect instead of seeing a wall of failed requests.
    if (res.status === 401) notifyUnauthorized()
    throw new GitHubApiError(message, res.status)
  }

  const text = await res.text()
  return text ? (JSON.parse(text) as T) : (undefined as T)
}

/** Follows GitHub's page-numbered list responses until every item has been collected. */
export async function paginate<TItem>(
  fetchPage: (page: number) => Promise<{ totalCount: number; items: TItem[] }>,
): Promise<TItem[]> {
  const all: TItem[] = []
  let page = 1
  while (true) {
    const { totalCount, items } = await fetchPage(page)
    all.push(...items)
    if (items.length === 0 || all.length >= totalCount) break
    page += 1
  }
  return all
}

/** Follows GitHub's bare-array list endpoints (Link-header pagination) by page size. */
export async function paginateArray<TItem>(fetchPage: (page: number) => Promise<TItem[]>): Promise<TItem[]> {
  const all: TItem[] = []
  let page = 1
  while (true) {
    const items = await fetchPage(page)
    all.push(...items)
    if (items.length < 100) break
    page += 1
  }
  return all
}
