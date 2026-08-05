import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { GitHubApiError } from './client'
import { createEnvironment, deleteEnvironment, listEnvironments } from './environments'
import { itemId } from './paths'
import { listOrgRunners, listRepoRunners } from './runners'
import { getAccountType, listMyOrgs, listMyRepos, listOrgRepos } from './scopes'
import { createVariable, deleteVariable, listVariables, updateVariable } from './variables'
import { deleteSecret, listSecrets, putSecret, type PutSecretOptions } from './secrets'
import type { GithubEnvironment, ItemKind, ItemLevel, LedgerItem, ScopeRef } from './types'

export function sameScope(a: ScopeRef, b: ScopeRef): boolean {
  return a.org === b.org && a.repo === b.repo && a.env === b.env
}

function errorMessage(err: unknown): string {
  return err instanceof GitHubApiError
    ? `${err.message} (HTTP ${err.status})`
    : err instanceof Error
      ? err.message
      : 'Unknown error'
}

/** Snapshots every active ledger query so a failed optimistic update can roll back cleanly. */
async function snapshotLedger(qc: QueryClient) {
  await qc.cancelQueries({ queryKey: ['ledger'] })
  return qc.getQueriesData<LedgerResult>({ queryKey: ['ledger'] })
}

function restoreLedger(qc: QueryClient, snapshot: [QueryKey, LedgerResult | undefined][]) {
  snapshot.forEach(([key, data]) => qc.setQueryData(key, data))
}

function updateLedgerItems(qc: QueryClient, updater: (items: LedgerItem[]) => LedgerItem[]) {
  qc.setQueriesData<LedgerResult>({ queryKey: ['ledger'] }, (old) => (old ? { ...old, items: updater(old.items) } : old))
}

function optimisticVariable(level: ItemLevel, scope: ScopeRef, name: string, value: string): LedgerItem {
  const now = new Date().toISOString()
  return { id: itemId('variable', level, scope, name), kind: 'variable', level, scope, name, value, createdAt: now, updatedAt: now }
}

function optimisticSecret(
  level: ItemLevel,
  scope: ScopeRef,
  name: string,
  visibility?: LedgerItem['visibility'],
): LedgerItem {
  const now = new Date().toISOString()
  return { id: itemId('secret', level, scope, name), kind: 'secret', level, scope, name, visibility, createdAt: now, updatedAt: now }
}

export interface DashboardScope {
  org: string
  repo?: string
}

export interface LedgerPartialError {
  label: string
  message: string
}

/** A level/kind combo the current token has no rights to see (403/404) — shown as "locked", not an error. */
export interface LedgerLockedSection {
  level: ItemLevel
  kind: ItemKind
  scopeLabel: string
  env?: string
}

export interface LedgerResult {
  items: LedgerItem[]
  partialErrors: LedgerPartialError[]
  lockedSections: LedgerLockedSection[]
}

interface LedgerJob {
  level: ItemLevel
  kind: ItemKind
  scopeLabel: string
  env?: string
  promise: Promise<LedgerItem[]>
}

function jobLabel(job: LedgerJob): string {
  const kindLabel = job.kind === 'variable' ? 'variables' : 'secrets'
  if (job.level === 'organization') return `organization ${kindLabel}`
  if (job.level === 'repository') return `repository ${kindLabel}`
  return `environment "${job.env}" ${kindLabel}`
}

/**
 * Runs every list call independently so one failure doesn't blank the whole ledger.
 * A 403/404 (no rights to that level/kind) becomes a "locked" section, not a red error —
 * everything else (network errors, 5xx, rate limits) still surfaces as a real error.
 */
async function runLedgerJobs(jobs: LedgerJob[]): Promise<LedgerResult> {
  const settled = await Promise.allSettled(jobs.map((j) => j.promise))
  const items: LedgerItem[] = []
  const partialErrors: LedgerPartialError[] = []
  const lockedSections: LedgerLockedSection[] = []

  settled.forEach((result, i) => {
    const job = jobs[i]
    if (result.status === 'fulfilled') {
      items.push(...result.value)
      return
    }
    const err = result.reason
    if (err instanceof GitHubApiError && (err.status === 403 || err.status === 404)) {
      lockedSections.push({ level: job.level, kind: job.kind, scopeLabel: job.scopeLabel, env: job.env })
      return
    }
    const message =
      err instanceof GitHubApiError
        ? `${err.message} (HTTP ${err.status})`
        : err instanceof Error
          ? err.message
          : 'Unknown error'
    partialErrors.push({ label: jobLabel(job), message })
  })

  if (items.length === 0 && partialErrors.length > 0 && partialErrors.length === jobs.length) {
    throw new Error(partialErrors.map((e) => `${e.label} — ${e.message}`).join('; '))
  }

  return { items, partialErrors, lockedSections }
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
 * Self-hosted runners in scope: repo runners for a repo scope, org runners for an org-only scope.
 * Polled every 30s since online/offline/busy status is live state, not something a manual
 * mutation here ever changes — a one-off fetch would go stale the moment a runner picks up a job.
 */
export function useRunners(token: string | null, scope: DashboardScope | null) {
  return useQuery({
    queryKey: ['runners', token, scope?.org, scope?.repo],
    queryFn: () => (scope!.repo ? listRepoRunners(token!, scope!.org, scope!.repo) : listOrgRunners(token!, scope!.org)),
    enabled: !!token && !!scope,
    refetchInterval: 30_000,
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
            {
              level: 'organization',
              kind: 'variable',
              scopeLabel: s.org,
              promise: listVariables(token!, { org: s.org }, 'organization'),
            },
            {
              level: 'organization',
              kind: 'secret',
              scopeLabel: s.org,
              promise: listSecrets(token!, { org: s.org }, 'organization'),
            },
          ]
        : []

      if (s.repo) {
        jobs.push(
          {
            level: 'repository',
            kind: 'variable',
            scopeLabel: s.repo,
            promise: listVariables(token!, { org: s.org, repo: s.repo }, 'repository'),
          },
          {
            level: 'repository',
            kind: 'secret',
            scopeLabel: s.repo,
            promise: listSecrets(token!, { org: s.org, repo: s.repo }, 'repository'),
          },
        )
        for (const env of environments) {
          const envScope: ScopeRef = { org: s.org, repo: s.repo, env: env.name }
          jobs.push(
            {
              level: 'environment',
              kind: 'variable',
              scopeLabel: env.name,
              env: env.name,
              promise: listVariables(token!, envScope, 'environment'),
            },
            {
              level: 'environment',
              kind: 'secret',
              scopeLabel: env.name,
              env: env.name,
              promise: listSecrets(token!, envScope, 'environment'),
            },
          )
        }
      }

      return runLedgerJobs(jobs)
    },
    enabled: !!token && !!scope && environmentsReady && orgLevelReady,
  })
}

interface CreateVariableParams {
  scope: ScopeRef
  level: ItemLevel
  name: string
  value: string
}

export function useCreateVariable(token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: CreateVariableParams) => createVariable(token!, p.scope, p.level, p.name, p.value),
    onMutate: async (p) => {
      const snapshot = await snapshotLedger(qc)
      updateLedgerItems(qc, (items) => [...items, optimisticVariable(p.level, p.scope, p.name, p.value)])
      return { snapshot }
    },
    onError: (_err, _p, context) => context && restoreLedger(qc, context.snapshot),
  })
}

interface UpdateVariableParams {
  scope: ScopeRef
  level: ItemLevel
  currentName: string
  newName: string
  value: string
}

/** Also handles renames — GitHub's update endpoint accepts a different `name` in the body. */
export function useUpdateVariable(token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: UpdateVariableParams) => updateVariable(token!, p.scope, p.level, p.currentName, p.newName, p.value),
    onMutate: async (p) => {
      const snapshot = await snapshotLedger(qc)
      updateLedgerItems(qc, (items) =>
        items.map((i) =>
          i.kind === 'variable' && i.level === p.level && i.name === p.currentName && sameScope(i.scope, p.scope)
            ? { ...i, name: p.newName, value: p.value, id: itemId('variable', p.level, p.scope, p.newName) }
            : i,
        ),
      )
      return { snapshot }
    },
    onError: (_err, _p, context) => context && restoreLedger(qc, context.snapshot),
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
    onMutate: async (p) => {
      const snapshot = await snapshotLedger(qc)
      updateLedgerItems(qc, (items) =>
        items.filter((i) => !(i.kind === 'variable' && i.level === p.level && i.name === p.name && sameScope(i.scope, p.scope))),
      )
      return { snapshot }
    },
    onError: (_err, _p, context) => context && restoreLedger(qc, context.snapshot),
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
    onMutate: async (p) => {
      const snapshot = await snapshotLedger(qc)
      const matches = (i: LedgerItem) =>
        i.kind === 'secret' && i.level === p.level && i.name === p.name && sameScope(i.scope, p.scope)
      updateLedgerItems(qc, (items) =>
        items.some(matches)
          ? items.map((i) => (matches(i) ? { ...i, visibility: p.options?.visibility ?? i.visibility } : i))
          : [...items, optimisticSecret(p.level, p.scope, p.name, p.options?.visibility)],
      )
      return { snapshot }
    },
    onError: (_err, _p, context) => context && restoreLedger(qc, context.snapshot),
  })
}

interface RenameSecretParams {
  scope: ScopeRef
  level: ItemLevel
  currentName: string
  newName: string
  value: string
  options?: PutSecretOptions
}

/**
 * Secrets have no rename API — GitHub can't copy a value it never stores in the clear, so a
 * "rename" is really: create the new name (with the freshly-entered value), then delete the old one.
 */
export function useRenameSecret(token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: RenameSecretParams) => {
      await putSecret(token!, p.scope, p.level, p.newName, p.value, p.options)
      await deleteSecret(token!, p.scope, p.level, p.currentName)
    },
    onMutate: async (p) => {
      const snapshot = await snapshotLedger(qc)
      updateLedgerItems(qc, (items) =>
        items.map((i) =>
          i.kind === 'secret' && i.level === p.level && i.name === p.currentName && sameScope(i.scope, p.scope)
            ? { ...i, name: p.newName, visibility: p.options?.visibility ?? i.visibility, id: itemId('secret', p.level, p.scope, p.newName) }
            : i,
        ),
      )
      return { snapshot }
    },
    onError: (_err, _p, context) => context && restoreLedger(qc, context.snapshot),
  })
}

export function useDeleteSecret(token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: DeleteParams) => deleteSecret(token!, p.scope, p.level, p.name),
    onMutate: async (p) => {
      const snapshot = await snapshotLedger(qc)
      updateLedgerItems(qc, (items) =>
        items.filter((i) => !(i.kind === 'secret' && i.level === p.level && i.name === p.name && sameScope(i.scope, p.scope))),
      )
      return { snapshot }
    },
    onError: (_err, _p, context) => context && restoreLedger(qc, context.snapshot),
  })
}

interface EnvironmentMutationParams {
  org: string
  repo: string
  name: string
}

export function useCreateEnvironment(token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: EnvironmentMutationParams) => createEnvironment(token!, p.org, p.repo, p.name),
    onMutate: async (p) => {
      const key = ['environments', token, p.org, p.repo]
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<GithubEnvironment[]>(key)
      // Insert immediately rather than waiting on a refetch — GitHub's list-environments read
      // can lag a moment behind the write that just succeeded, which otherwise makes a brand
      // new environment briefly (or indefinitely, if nothing else triggers a refetch) invisible.
      qc.setQueryData<GithubEnvironment[]>(key, (old) => {
        const list = old ?? []
        return list.some((e) => e.name === p.name) ? list : [...list, { name: p.name, id: -Date.now() }]
      })
      return { previous, key }
    },
    // No refetch on success — the PUT succeeding is itself the confirmation, and GitHub's list
    // read can lag behind the write by a moment (which would otherwise "un-create" it in the UI).
    // useLedger's query key already derives from this list, so it re-runs automatically once it
    // changes — no manual ledger invalidation needed either.
    onError: (_err, _p, context) => context && qc.setQueryData(context.key, context.previous),
  })
}

export function useDeleteEnvironment(token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: EnvironmentMutationParams) => deleteEnvironment(token!, p.org, p.repo, p.name),
    onMutate: async (p) => {
      const key = ['environments', token, p.org, p.repo]
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<GithubEnvironment[]>(key)
      qc.setQueryData<GithubEnvironment[]>(key, (old) => (old ?? []).filter((e) => e.name !== p.name))
      return { previous, key }
    },
    onError: (_err, _p, context) => context && qc.setQueryData(context.key, context.previous),
  })
}

export interface CopyTarget {
  level: ItemLevel
  scope: ScopeRef
  /** Whether this destination already has an item of the same name — decides create vs. update. */
  exists: boolean
}

export interface CopyResult {
  target: CopyTarget
  ok: boolean
  message?: string
}

/**
 * Pushes one variable/secret's value out to a batch of other scopes, reusing the same
 * create/update/put mutations (and their optimistic-update behavior) each destination already
 * goes through individually. Every target is attempted independently so one failure doesn't
 * hide whether the rest succeeded.
 */
export function useCopyItem(token: string | null) {
  const createVariable = useCreateVariable(token)
  const updateVariable = useUpdateVariable(token)
  const putSecret = usePutSecret(token)

  async function copyTo(
    kind: ItemKind,
    name: string,
    value: string,
    targets: CopyTarget[],
    options?: PutSecretOptions,
  ): Promise<CopyResult[]> {
    const settled = await Promise.allSettled(
      targets.map((t) =>
        kind === 'variable'
          ? t.exists
            ? updateVariable.mutateAsync({ scope: t.scope, level: t.level, currentName: name, newName: name, value })
            : createVariable.mutateAsync({ scope: t.scope, level: t.level, name, value })
          : putSecret.mutateAsync({ scope: t.scope, level: t.level, name, value, options }),
      ),
    )
    return settled.map((result, i) => ({
      target: targets[i],
      ok: result.status === 'fulfilled',
      message: result.status === 'rejected' ? errorMessage(result.reason) : undefined,
    }))
  }

  return { copyTo, isPending: createVariable.isPending || updateVariable.isPending || putSecret.isPending }
}

export interface DeleteEverywhereTarget {
  level: ItemLevel
  scope: ScopeRef
}

export interface DeleteEverywhereResult {
  target: DeleteEverywhereTarget
  ok: boolean
  message?: string
}

/** Deletes one variable/secret, by name, from every scope it's currently set in. */
export function useDeleteEverywhere(token: string | null) {
  const deleteVariable = useDeleteVariable(token)
  const deleteSecret = useDeleteSecret(token)

  async function deleteFrom(
    kind: ItemKind,
    name: string,
    targets: DeleteEverywhereTarget[],
  ): Promise<DeleteEverywhereResult[]> {
    const settled = await Promise.allSettled(
      targets.map((t) =>
        kind === 'variable'
          ? deleteVariable.mutateAsync({ scope: t.scope, level: t.level, name })
          : deleteSecret.mutateAsync({ scope: t.scope, level: t.level, name }),
      ),
    )
    return settled.map((result, i) => ({
      target: targets[i],
      ok: result.status === 'fulfilled',
      message: result.status === 'rejected' ? errorMessage(result.reason) : undefined,
    }))
  }

  return { deleteFrom, isPending: deleteVariable.isPending || deleteSecret.isPending }
}
