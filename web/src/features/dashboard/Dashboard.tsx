import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import {
  useDeleteSecret,
  useDeleteVariable,
  useEnvironments,
  useIsOrgAccount,
  useLedger,
  type DashboardScope,
} from '../../api/hooks'
import { Ledger } from '../ledger/Ledger'
import { RateLimitIndicator } from '../../components/RateLimitIndicator'
import { ItemEditorPanel } from '../item-editor/ItemEditorPanel'
import { ConfirmDialog } from '../../components/ConfirmDialog'
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

  const [editorState, setEditorState] = useState<EditorState>(null)
  const [deleteTarget, setDeleteTarget] = useState<LedgerItem | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div>
          <p className="font-mono text-xs text-text-dim">
            <Link to="/" className="hover:text-variable">
              scopes
            </Link>
            {breadcrumb.map((part, i) => (
              <span key={i}>
                {' / '}
                <span className={i === breadcrumb.length - 1 ? 'text-variable' : ''}>{part}</span>
              </span>
            ))}
          </p>
          <h1 className="mt-1 font-sans text-lg font-semibold text-text">{breadcrumb.join('/')}</h1>
        </div>
        <div className="flex items-center gap-4">
          <RateLimitIndicator />
          {viewer ? <span className="text-sm text-text-dim">{viewer.login}</span> : null}
          <button onClick={disconnect} className="text-sm text-secret hover:underline">
            Disconnect
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-6">
        <Ledger
          items={ledgerQuery.data?.items ?? []}
          isLoading={ledgerQuery.isLoading}
          error={ledgerQuery.error as Error | null}
          partialErrors={ledgerQuery.data?.partialErrors}
          environments={environmentsQuery.data ?? []}
          showRepoLevels={!!scope.repo}
          showOrgLevel={showOrgLevel}
          onAdd={() => setEditorState({ mode: 'create' })}
          onAddToSection={(level, env) => setEditorState({ mode: 'create', level, env })}
          onEdit={(item) => setEditorState({ mode: 'edit', item })}
          onDelete={(item) => setDeleteTarget(item)}
        />
      </main>

      {editorState ? (
        <ItemEditorPanel
          scope={scope}
          environments={environmentsQuery.data ?? []}
          initial={editorState.mode === 'edit' ? editorState.item : null}
          initialLevel={editorState.mode === 'create' ? editorState.level : undefined}
          initialEnv={editorState.mode === 'create' ? editorState.env : undefined}
          showOrgLevel={showOrgLevel}
          onClose={() => setEditorState(null)}
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
    </div>
  )
}
