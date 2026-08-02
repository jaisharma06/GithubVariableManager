import { githubFetch, paginate } from './client'
import { sealSecret } from '../lib/crypto'
import { itemId, secretsPath } from './paths'
import type { ItemLevel, LedgerItem, PublicKey, ScopeRef, SecretVisibility } from './types'

interface RawSecret {
  name: string
  created_at: string
  updated_at: string
  visibility?: SecretVisibility
}

export async function listSecrets(token: string, scope: ScopeRef, level: ItemLevel): Promise<LedgerItem[]> {
  const items = await paginate<RawSecret>(async (page) => {
    const data = await githubFetch<{ total_count: number; secrets: RawSecret[] }>(
      token,
      `${secretsPath(scope, level)}?per_page=100&page=${page}`,
    )
    return { totalCount: data.total_count, items: data.secrets }
  })

  return items.map((s) => ({
    id: itemId('secret', level, scope, s.name),
    kind: 'secret' as const,
    level,
    scope,
    name: s.name,
    visibility: s.visibility,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }))
}

export async function getPublicKey(token: string, scope: ScopeRef, level: ItemLevel): Promise<PublicKey> {
  return githubFetch<PublicKey>(token, `${secretsPath(scope, level)}/public-key`)
}

export interface PutSecretOptions {
  visibility?: SecretVisibility
  selectedRepositoryIds?: number[]
}

export async function putSecret(
  token: string,
  scope: ScopeRef,
  level: ItemLevel,
  name: string,
  plaintextValue: string,
  options?: PutSecretOptions,
) {
  const publicKey = await getPublicKey(token, scope, level)
  const encrypted_value = await sealSecret(plaintextValue, publicKey.key)

  const body: Record<string, unknown> = { encrypted_value, key_id: publicKey.key_id }
  if (level === 'organization') {
    const visibility = options?.visibility ?? 'all'
    body.visibility = visibility
    if (visibility === 'selected') {
      body.selected_repository_ids = options?.selectedRepositoryIds ?? []
    }
  }

  await githubFetch(token, `${secretsPath(scope, level)}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function deleteSecret(token: string, scope: ScopeRef, level: ItemLevel, name: string) {
  await githubFetch(token, `${secretsPath(scope, level)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}
