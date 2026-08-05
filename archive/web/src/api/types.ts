export type ItemKind = 'variable' | 'secret'
export type ItemLevel = 'organization' | 'repository' | 'environment'
export type SecretVisibility = 'all' | 'private' | 'selected'

export interface ScopeRef {
  org: string
  repo?: string
  env?: string
}

export interface LedgerItem {
  id: string
  kind: ItemKind
  level: ItemLevel
  scope: ScopeRef
  name: string
  value?: string
  visibility?: SecretVisibility
  createdAt: string
  updatedAt: string
}

export interface GithubEnvironment {
  name: string
  id: number
}

export interface GithubRepo {
  id: number
  name: string
  fullName: string
  owner: string
  private: boolean
}

export interface GithubOrg {
  login: string
  avatarUrl: string
}

export interface Viewer {
  login: string
  avatarUrl: string
}

export interface PublicKey {
  key_id: string
  key: string
}

export interface RateLimitInfo {
  remaining: number
  limit: number
  resetAt: number | null
}
