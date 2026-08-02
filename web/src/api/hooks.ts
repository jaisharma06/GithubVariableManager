import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitHubApiError } from './client'
import { listEnvironments } from './environments'
import { getAccountType, listMyOrgs, listMyRepos, listOrgRepos } from './scopes'
import { createVariable, deleteVariable, listVariables, updateVariable } from './variables'
import { deleteSecret, listSecrets, putSecret, type PutSecretOptions } from './secrets'
import type { ItemLevel, LedgerItem, ScopeRef } from './types'

export interface DashboardScope {
  org: string
  repo?: string
}

export interface LedgerPartialError {
  label: string
  message: string
}

export interface LedgerResult {
  items: LedgerItem[]
  partialErrors: LedgerPartialError[]
}

interface LedgerJob {
  label: string
  promise: Promise<LedgerItem[]>
}

/** Runs every list call independently so one 404/403 (e.g. missing org-level access) doesn't blank the whole ledger. */
async function runLedgerJobs(jobs: LedgerJob[]): Promise<LedgerResult> {
  const settled = await Promise.allSettled(jobs.map((j) => j.promise))
  const items: LedgerItem[] = []
  const partialErrors: LedgerPartialError[] = []

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value)
      return
    }
    const err = result.reason
    const message =
      err instanceof GitHubApiError
        ? `${err.message} (HTTP ${err.status})`
        : err instanceof Error
          ? err.message
          : 'Unknown error'
    partialErrors.push({ label: jobs[i].label, message })
  })

  if (items.length === 0 && partialErrors.length > 0 && partialErrors.length === jobs.length) {
    throw new Error(partialErrors.map((e) => `${e.label} — ${e.message}`).join('; '))
  }

  return { items, partialErrors }
}

export function useMyOrgs(token: string | null) {
  return useQuery({
    queryKey: ['orgs', token],
    queryFn: () => listMyOrgs(token!),
    enabled: !!token,
  })
}

export function useMyRepos(token: string | null) {
  return useQuery({
    queryKey: ['repos', token],
    queryFn: () => listMyRepos(token!),
    enabled: !!token,
  })
}

export function useOrgRepos(token: string | null, org: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['org-repos', token, org],
    queryFn: () => listOrgRepos(token!, org!),
    enabled: !!token && !!org && enabled,
  })
}

export function useEnvironments(token: string | null, scope: DashboardScope | null) {
  return useQuery({
    queryKey: ['environments', token, scope?.org, scope?.repo],
    queryFn: () => listEnvironments(token!, scope!.org, scope!.repo!),
    enabled: !!token && !!scope?.repo,
  })
}

/**
 * Whether a repo scope's owner is a real GitHub Organization (as opposed to a personal user
 * account, which has no org-level Actions variables/secrets at all). Only relevant for repo
 * scopes — the org picker (`/o/:org`) only ever lists real organizations already.
 */
export function useIsOrgAccount(token: string | null, login: string | null) {
  return useQuery({
    queryKey: ['account-type', token, login],
    queryFn: () => getAccountType(token!, login!),
    enabled: !!token && !!login,
    staleTime: Infinity,
    select: (type) => type === 'Organization',
  })
}

/**
 * The ledger: every variable and secret in scope, merged into one list.
 * Org scope alone → org-level only. Repo scope → repo + every environment on that repo, plus
 * org-level too if (and only if) the repo's owner is an actual Organization account.
 */
export function useLedger(token: string | null, scope: DashboardScope | null) {
  const environmentsQuery = useEnvironments(token, scope)
  const environments = environmentsQuery.data ?? []
  const environmentsReady = !scope?.repo || environmentsQuery.isSuccess

  const isOrgAccountQuery = useIsOrgAccount(token, scope?.repo ? scope.org : null)
  // Org-only scopes are always real orgs (see ScopePicker); repo scopes need the account-type check.
  const orgLevelApplies = !scope?.repo || isOrgAccountQuery.data === true
  const orgLevelReady = !scope?.repo || isOrgAccountQuery.isSuccess || isOrgAccountQuery.isError

  return useQuery({
    queryKey: [
      'ledger',
      token,
      scope?.org,
      scope?.repo,
      environments.map((e) => e.name).join(','),
      orgLevelApplies,
    ],
    queryFn: async () => {
      const s = scope!
      const jobs: LedgerJob[] = orgLevelApplies
        ? [
            { label: 'organization variables', promise: listVariables(token!, { org: s.org }, 'organization') },
            { label: 'organization secrets', promise: listSecrets(token!, { org: s.org }, 'organization') },
          ]
        : []

      if (s.repo) {
        jobs.push(
          {
            label: 'repository variables',
            promise: listVariables(token!, { org: s.org, repo: s.repo }, 'repository'),
          },
          { label: 'repository secrets', promise: listSecrets(token!, { org: s.org, repo: s.repo }, 'repository') },
        )
        for (const env of environments) {
          const envScope: ScopeRef = { org: s.org, repo: s.repo, env: env.name }
          jobs.push(
            { label: `environment "${env.name}" variables`, promise: listVariables(token!, envScope, 'environment') },
            { label: `environment "${env.name}" secrets`, promise: listSecrets(token!, envScope, 'environment') },
          )
        }
      }

      return runLedgerJobs(jobs)
    },
    enabled: !!token && !!scope && environmentsReady && orgLevelReady,
  })
}

interface VariableMutationParams {
  scope: ScopeRef
  level: ItemLevel
  name: string
  value: string
}

export function useCreateVariable(token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: VariableMutationParams) => createVariable(token!, p.scope, p.level, p.name, p.value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ledger'] }),
  })
}

export function useUpdateVariable(token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: VariableMutationParams) => updateVariable(token!, p.scope, p.level, p.name, p.value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ledger'] }),
  })
}

interface DeleteParams {
  scope: ScopeRef
  level: ItemLevel
  name: string
}

export function useDeleteVariable(token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: DeleteParams) => deleteVariable(token!, p.scope, p.level, p.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ledger'] }),
  })
}

interface SecretMutationParams {
  scope: ScopeRef
  level: ItemLevel
  name: string
  value: string
  options?: PutSecretOptions
}

export function usePutSecret(token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: SecretMutationParams) => putSecret(token!, p.scope, p.level, p.name, p.value, p.options),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ledger'] }),
  })
}

export function useDeleteSecret(token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: DeleteParams) => deleteSecret(token!, p.scope, p.level, p.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ledger'] }),
  })
}
