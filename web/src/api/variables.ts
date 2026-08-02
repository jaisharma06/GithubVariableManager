import { githubFetch, paginate } from './client'
import { itemId, variablesPath } from './paths'
import type { ItemLevel, LedgerItem, ScopeRef } from './types'

interface RawVariable {
  name: string
  value: string
  created_at: string
  updated_at: string
}

export async function listVariables(token: string, scope: ScopeRef, level: ItemLevel): Promise<LedgerItem[]> {
  const items = await paginate<RawVariable>(async (page) => {
    const data = await githubFetch<{ total_count: number; variables: RawVariable[] }>(
      token,
      `${variablesPath(scope, level)}?per_page=100&page=${page}`,
    )
    return { totalCount: data.total_count, items: data.variables }
  })

  return items.map((v) => ({
    id: itemId('variable', level, scope, v.name),
    kind: 'variable' as const,
    level,
    scope,
    name: v.name,
    value: v.value,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  }))
}

export async function createVariable(token: string, scope: ScopeRef, level: ItemLevel, name: string, value: string) {
  await githubFetch(token, variablesPath(scope, level), {
    method: 'POST',
    body: JSON.stringify({ name, value }),
  })
}

/**
 * `currentName` selects the variable being updated (the URL); `newName` in the body is what
 * GitHub actually renames it to if different — this endpoint doubles as a rename.
 */
export async function updateVariable(
  token: string,
  scope: ScopeRef,
  level: ItemLevel,
  currentName: string,
  newName: string,
  value: string,
) {
  await githubFetch(token, `${variablesPath(scope, level)}/${encodeURIComponent(currentName)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: newName, value }),
  })
}

export async function deleteVariable(token: string, scope: ScopeRef, level: ItemLevel, name: string) {
  await githubFetch(token, `${variablesPath(scope, level)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}
