import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import {
  useCreateEnvironment,
  useDeleteEnvironment,
  useDeleteSecret,
  useDeleteVariable,
  useEnvironments,
  useIsOrgAccount,
  useLedger,
  type DashboardScope,
} from '../../api/hooks'
import { Ledger } from '../ledger/Ledger'
import { defaultFilters, type LedgerFilters } from '../ledger/FilterBar'
import { CopyItemDialog } from '../ledger/CopyItemDialog'
import { CompareView } from '../compare/CompareView'
import { ScopeSidebar } from './ScopeSidebar'
import { RunnersPanel } from './RunnersPanel'
import { RenameEnvironmentDialog } from './RenameEnvironmentDialog'
import { RateLimitIndicator } from '../../components/RateLimitIndicator'
import { Avatar } from '../../components/Avatar'
import { ItemEditorPanel } from '../item-editor/ItemEditorPanel'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { setLastScope } from '../../lib/lastScope'
import type { ItemLevel, LedgerItem } from '../../api/types'

type EditorState =
  | { mode: 'create'; level?: ItemLevel; env?: string }
  | { mode: 'edit'; item: LedgerItem }
  | null

export function OrgDashboard() {
  const { org } = useParams<{ org: string }>()
  return <DashboardShell scope={{ org: org! }} breadcrumb={[org!]} />
}

export function RepoDashboard() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  return <DashboardShell scope={{ org: owner!, repo: repo! }} breadcrumb={[owner!, repo!]} />
}

function DashboardShell({ scope, breadcrumb }: { scope: DashboardScope; breadcrumb: string[] }) {
  const { token, viewer, disconnect } = useAuth()
  const ledgerQuery = useLedger(token, scope)
  const environmentsQuery = useEnvironments(token, scope)
  const isOrgAccountQuery = useIsOrgAccount(token, scope.repo ? scope.org : null)
  const showOrgLevel = !scope.repo || isOrgAccountQuery.data === true
  const deleteVariable = useDeleteVariable(token)
  const deleteSecret = useDeleteSecret(token)
  const createEnvironment = useCreateEnvironment(token)
  const deleteEnvironment = useDeleteEnvironment(token)

  const breadcrumbLabel = breadcrumb.join('/')
  useEffect(() => {
    const path = scope.repo ? `/r/${scope.org}/${scope.repo}` : `/o/${scope.org}`
    setLastScope({ path, label: breadcrumbLabel })
  }, [scope.org, scope.repo, breadcrumbLabel])

  const [filters, setFilters] = useState<LedgerFilters>(defaultFilters)
  const [editorState, setEditorState] = useState<EditorState>(null)
  const [copyTarget, setCopyTarget] = useState<LedgerItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LedgerItem | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [envToDelete, setEnvToDelete] = useState<string | null>(null)
  const [envDeleteError, setEnvDeleteError] = useState<string | null>(null)
  const [envToRename, setEnvToRename] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'compare'>('list')
  const ledgerItems = ledgerQuery.data?.items ?? []

  function handleSidebarNavigate(level: LedgerFilters['level'], env?: string) {
    if (level === 'all') {
      setFilters(defaultFilters)
    } else {
      setFilters((f) => ({ ...f, level, env: env ?? 'all' }))
    }
  }

  async function handleCreateEnvironment(name: string) {
    if (!scope.repo) return
    await createEnvironment.mutateAsync({ org: scope.org, repo: scope.repo, name })
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleteError(null)
    const params = { scope: deleteTarget.scope, level: deleteTarget.level, name: deleteTarget.name }
    try {
      if (deleteTarget.kind === 'variable') await deleteVariable.mutateAsync(params)
      else await deleteSecret.mutateAsync(params)
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'GitHub rejected this request.')
    }
  }

  function handleCancelDelete() {
    setDeleteTarget(null)
    setDeleteError(null)
  }

  async function handleConfirmDeleteEnv() {
    if (!envToDelete || !scope.repo) return
    setEnvDeleteError(null)
    try {
      await deleteEnvironment.mutateAsync({ org: scope.org, repo: scope.repo, name: envToDelete })
      setEnvToDelete(null)
    } catch (err) {
      setEnvDeleteError(err instanceof Error ? err.message : 'GitHub rejected this request.')
    }
  }

  function handleCancelDeleteEnv() {
    setEnvToDelete(null)
    setEnvDeleteError(null)
  }

  function handleEnvironmentRenamed(oldName: string, newName: string) {
    setFilters((f) => (f.env === oldName ? { ...f, env: newName } : f))
    setEnvToRename(null)
  }

  return (
    <div className="flex min-h-screen bg-ink">
      <aside className="fixed inset-y-0 left-0 flex h-screen w-64 shrink-0 flex-col overflow-hidden border-r border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-4 py-4">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-brand font-display text-xs font-bold text-on-brand">
            G
          </span>
          <span className="truncate font-display text-sm font-semibold text-text">Variables Manager</span>
        </div>

        <div className="flex-1 overflow-hidden px-2 py-4">
          <ScopeSidebar
            org={scope.org}
            repo={scope.repo}
            environments={environmentsQuery.data ?? []}
            showOrgLevel={showOrgLevel}
            filters={filters}
            onNavigate={handleSidebarNavigate}
            onCreateEnvironment={handleCreateEnvironment}
            onRenameEnvironment={setEnvToRename}
            onDeleteEnvironment={setEnvToDelete}
          />
        </div>

        <div className="border-t border-line px-2 py-3">
          <RunnersPanel scope={scope} />
        </div>

        <div className="border-t border-line px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            {viewer ? (
              <span className="flex min-w-0 items-center gap-2">
                <Avatar login={viewer.login} avatarUrl={viewer.avatarUrl} size={20} />
                <span className="truncate text-xs text-text-dim">{viewer.login}</span>
              </span>
            ) : null}
            <button onClick={disconnect} className="shrink-0 text-xs text-secret hover:underline">
              Disconnect
            </button>
          </div>
        </div>
      </aside>

      <div className="ml-64 flex flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
          <h1 className="font-display text-lg font-semibold text-text">{breadcrumb.join(' / ')}</h1>
          <div className="flex items-center gap-3">
            {scope.repo ? (
              <div className="flex items-center gap-0.5 rounded-md border border-line bg-ink p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-pressed={viewMode === 'list'}
                  className={`rounded px-2.5 py-1 font-sans text-xs font-medium transition-colors ${
                    viewMode === 'list' ? 'bg-brand-dim text-brand' : 'text-text-dim hover:text-text'
                  }`}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('compare')}
                  aria-pressed={viewMode === 'compare'}
                  className={`rounded px-2.5 py-1 font-sans text-xs font-medium transition-colors ${
                    viewMode === 'compare' ? 'bg-brand-dim text-brand' : 'text-text-dim hover:text-text'
                  }`}
                >
                  Compare
                </button>
              </div>
            ) : null}
            <RateLimitIndicator />
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
          {viewMode === 'compare' && scope.repo ? (
            <CompareView
              scope={scope}
              environments={environmentsQuery.data ?? []}
              items={ledgerItems}
              showOrgLevel={showOrgLevel}
              isLoading={ledgerQuery.isLoading}
              error={ledgerQuery.error as Error | null}
            />
          ) : (
            <Ledger
              items={ledgerItems}
              isLoading={ledgerQuery.isLoading}
              error={ledgerQuery.error as Error | null}
              partialErrors={ledgerQuery.data?.partialErrors}
              lockedSections={ledgerQuery.data?.lockedSections}
              environments={environmentsQuery.data ?? []}
              showRepoLevels={!!scope.repo}
              showOrgLevel={showOrgLevel}
              filters={filters}
              onFiltersChange={setFilters}
              onAdd={() => setEditorState({ mode: 'create' })}
              onAddToSection={(level, env) => setEditorState({ mode: 'create', level, env })}
              onEdit={(item) => setEditorState({ mode: 'edit', item })}
              onCopy={(item) => setCopyTarget(item)}
              onDelete={(item) => setDeleteTarget(item)}
            />
          )}
        </main>
      </div>

      {editorState ? (
        <ItemEditorPanel
          scope={scope}
          environments={environmentsQuery.data ?? []}
          items={ledgerItems}
          initial={editorState.mode === 'edit' ? editorState.item : null}
          initialLevel={editorState.mode === 'create' ? editorState.level : undefined}
          initialEnv={editorState.mode === 'create' ? editorState.env : undefined}
          showOrgLevel={showOrgLevel}
          onClose={() => setEditorState(null)}
        />
      ) : null}

      {copyTarget ? (
        <CopyItemDialog
          item={copyTarget}
          scope={scope}
          environments={environmentsQuery.data ?? []}
          showOrgLevel={showOrgLevel}
          items={ledgerItems}
          onClose={() => setCopyTarget(null)}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={`Delete ${deleteTarget.kind === 'variable' ? 'variable' : 'secret'} “${deleteTarget.name}”?`}
          description={`This removes it from GitHub at the ${deleteTarget.level} level. This can't be undone.`}
          confirmLabel="Delete"
          error={deleteError}
          confirming={deleteVariable.isPending || deleteSecret.isPending}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      ) : null}

      {envToRename && scope.repo ? (
        <RenameEnvironmentDialog
          org={scope.org}
          repo={scope.repo}
          oldName={envToRename}
          environments={environmentsQuery.data ?? []}
          items={ledgerItems}
          onClose={() => setEnvToRename(null)}
          onRenamed={handleEnvironmentRenamed}
        />
      ) : null}

      {envToDelete ? (
        <ConfirmDialog
          title={`Delete environment "${envToDelete}"?`}
          description="This also removes every variable and secret set at this environment level. This can't be undone."
          confirmLabel="Delete"
          error={envDeleteError}
          confirming={deleteEnvironment.isPending}
          onConfirm={handleConfirmDeleteEnv}
          onCancel={handleCancelDeleteEnv}
        />
      ) : null}
    </div>
  )
}
