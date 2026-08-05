import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useDeleteEverywhere, type DashboardScope } from '../../api/hooks'
import type { GithubEnvironment, ItemKind, ItemLevel, LedgerItem, ScopeRef } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ItemEditorPanel } from '../item-editor/ItemEditorPanel'
import { CopyItemDialog } from '../ledger/CopyItemDialog'

interface CompareViewProps {
  scope: DashboardScope
  environments: GithubEnvironment[]
  items: LedgerItem[]
  showOrgLevel: boolean
  isLoading: boolean
  error: Error | null
}

interface Column {
  key: string
  label: string
  level: ItemLevel
  scope: ScopeRef
}

interface Row {
  kind: ItemKind
  name: string
  cells: Map<string, LedgerItem>
}

function columnKeyFor(level: ItemLevel, env?: string): string {
  return level === 'environment' ? `env:${env}` : level
}

export function CompareView({ scope, environments, items, showOrgLevel, isLoading, error }: CompareViewProps) {
  const { token } = useAuth()
  const { deleteFrom, isPending: deleting } = useDeleteEverywhere(token)

  const columns = useMemo<Column[]>(() => {
    const cols: Column[] = []
    if (showOrgLevel) cols.push({ key: 'organization', label: `Org · ${scope.org}`, level: 'organization', scope: { org: scope.org } })
    if (scope.repo) {
      cols.push({ key: 'repository', label: `Repo · ${scope.repo}`, level: 'repository', scope: { org: scope.org, repo: scope.repo } })
      for (const env of environments) {
        cols.push({
          key: `env:${env.name}`,
          label: env.name,
          level: 'environment',
          scope: { org: scope.org, repo: scope.repo, env: env.name },
        })
      }
    }
    return cols
  }, [scope, environments, showOrgLevel])

  // Org/repo-level vars & secrets apply everywhere already — default the comparison to just
  // the environments, where values are most likely to actually differ. Still one click away.
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set(['organization', 'repository']))
  const [kindFilter, setKindFilter] = useState<ItemKind | 'all'>('all')
  const [search, setSearch] = useState('')
  const [hideValues, setHideValues] = useState(false)

  const [editTarget, setEditTarget] = useState<{ item: LedgerItem | null; column: Column; name: string; kind: ItemKind } | null>(null)
  const [copySource, setCopySource] = useState<LedgerItem | null>(null)
  const [deleteRow, setDeleteRow] = useState<{ kind: ItemKind; name: string; targets: { level: ItemLevel; scope: ScopeRef; label: string }[] } | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function toggleColumn(key: string) {
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const visibleColumns = columns.filter((c) => !deselected.has(c.key))
  const visibleKeys = useMemo(() => new Set(visibleColumns.map((c) => c.key)), [visibleColumns])

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>()
    for (const item of items) {
      const colKey = columnKeyFor(item.level, item.scope.env)
      if (!visibleKeys.has(colKey)) continue
      if (kindFilter !== 'all' && item.kind !== kindFilter) continue
      if (search && !item.name.toLowerCase().includes(search.toLowerCase())) continue
      const rowKey = `${item.kind}:${item.name}`
      if (!map.has(rowKey)) map.set(rowKey, { kind: item.kind, name: item.name, cells: new Map() })
      map.get(rowKey)!.cells.set(colKey, item)
    }
    return [...map.values()].sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'variable' ? -1 : 1,
    )
  }, [items, visibleKeys, kindFilter, search])

  function fullOccurrences(kind: ItemKind, name: string) {
    return items
      .filter((i) => i.kind === kind && i.name === name)
      .map((i) => {
        const col = columns.find((c) => c.key === columnKeyFor(i.level, i.scope.env))
        return { level: i.level, scope: i.scope, label: col?.label ?? i.level }
      })
  }

  async function handleConfirmDelete() {
    if (!deleteRow) return
    setDeleteError(null)
    const outcome = await deleteFrom(deleteRow.kind, deleteRow.name, deleteRow.targets)
    const failed = outcome.filter((r) => !r.ok)
    if (failed.length === 0) {
      setDeleteRow(null)
    } else {
      setDeleteError(`Failed for ${failed.length} of ${outcome.length}: ${failed.map((f) => f.message).join('; ')}`)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel p-6">
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-panel-raised" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-line bg-panel p-6 text-center">
        <p className="font-display text-sm font-semibold text-danger">Couldn&rsquo;t load this scope</p>
        <p className="mt-2 text-sm text-text-dim">{error.message}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-sm shadow-black/[0.03]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-0.5 rounded-md border border-line bg-ink p-0.5">
          {(['all', 'variable', 'secret'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              aria-pressed={kindFilter === k}
              className={`rounded px-2.5 py-1 font-sans text-xs font-medium transition-colors ${
                kindFilter === k ? 'bg-brand-dim text-brand' : 'text-text-dim hover:text-text'
              }`}
            >
              {k === 'all' ? 'All types' : k === 'variable' ? 'Variables' : 'Secrets'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {columns.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => toggleColumn(c.key)}
              aria-pressed={!deselected.has(c.key)}
              title={deselected.has(c.key) ? `Show ${c.label}` : `Hide ${c.label}`}
              className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                deselected.has(c.key)
                  ? 'border-line text-text-dim/50 line-through hover:text-text-dim'
                  : 'border-brand/40 bg-brand-dim text-brand'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setHideValues((v) => !v)}
          aria-pressed={hideValues}
          className={`ml-auto shrink-0 rounded-md border px-2.5 py-1.5 font-sans text-xs font-medium transition-colors ${
            hideValues ? 'border-brand bg-brand-dim text-brand' : 'border-line text-text-dim hover:text-text'
          }`}
        >
          {hideValues ? 'Values hidden' : 'Hide values'}
        </button>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name&hellip;"
          className="min-w-[10rem] rounded-md border border-line bg-ink px-2.5 py-1.5 font-mono text-xs text-text placeholder:text-text-dim/60 focus:border-brand focus:outline-none"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-text-dim">
              {visibleColumns.length === 0
                ? 'Pick at least one scope above to compare.'
                : 'Nothing matches these filters, or nothing is set in the selected scopes.'}
            </p>
          </div>
        ) : (
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 min-w-[10rem] border-r border-line bg-panel px-3 py-2 text-left font-sans text-[11px] font-medium uppercase tracking-wider text-text-dim">
                  Name
                </th>
                {visibleColumns.map((c) => (
                  <th
                    key={c.key}
                    className="min-w-[12rem] border-r border-line px-3 py-2 text-left font-sans text-[11px] font-medium uppercase tracking-wider text-text-dim last:border-r-0"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.kind}:${row.name}`} className="group border-b border-line last:border-b-0 hover:bg-panel-raised">
                  <td className="sticky left-0 z-10 border-r border-line bg-panel px-3 py-2 group-hover:bg-panel-raised">
                    <div className="flex items-center gap-2">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide ${
                          row.kind === 'secret' ? 'bg-secret-dim text-secret' : 'bg-variable-dim text-variable'
                        }`}
                      >
                        {row.kind === 'secret' ? 'SEC' : 'VAR'}
                      </span>
                      <span className="truncate font-mono text-xs text-text">{row.name}</span>
                      <button
                        type="button"
                        title={`Delete "${row.name}" from every scope it's set in`}
                        onClick={() => setDeleteRow({ kind: row.kind, name: row.name, targets: fullOccurrences(row.kind, row.name) })}
                        className="ml-auto shrink-0 rounded p-1 text-text-dim hover:text-danger"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                  {visibleColumns.map((c) => {
                    const cell = row.cells.get(c.key)
                    return (
                      <td key={c.key} className="border-r border-line px-3 py-2 last:border-r-0">
                        {cell ? (
                          <div className="flex items-center gap-1.5">
                            {cell.kind === 'secret' ? (
                              <span className="truncate font-mono text-xs tracking-widest text-secret">••••••••</span>
                            ) : hideValues ? (
                              <span className="truncate font-mono text-xs tracking-widest text-text-dim">••••••••</span>
                            ) : (
                              <span className="truncate font-mono text-xs text-text">{cell.value}</span>
                            )}
                            <button
                              type="button"
                              title="Edit"
                              onClick={() => setEditTarget({ item: cell, column: c, name: row.name, kind: row.kind })}
                              className="ml-auto shrink-0 rounded p-1 text-text-dim opacity-0 hover:text-text group-hover:opacity-100"
                            >
                              <EditIcon />
                            </button>
                            {cell.kind === 'variable' ? (
                              <button
                                type="button"
                                title="Copy this value elsewhere"
                                onClick={() => setCopySource(cell)}
                                className="shrink-0 rounded p-1 text-text-dim opacity-0 hover:text-brand group-hover:opacity-100"
                              >
                                <CopyIcon />
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditTarget({ item: null, column: c, name: row.name, kind: row.kind })}
                            className="flex w-full items-center gap-1 text-left text-xs text-text-dim/60 hover:text-brand"
                          >
                            <span>not set</span>
                            <span className="opacity-0 group-hover:opacity-100">+ add</span>
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editTarget ? (
        <ItemEditorPanel
          scope={scope}
          environments={environments}
          items={items}
          initial={editTarget.item}
          initialLevel={editTarget.column.level}
          initialEnv={editTarget.column.scope.env}
          initialName={editTarget.name}
          initialKind={editTarget.kind}
          lockTarget={!editTarget.item}
          showOrgLevel={showOrgLevel}
          onClose={() => setEditTarget(null)}
        />
      ) : null}

      {copySource ? (
        <CopyItemDialog
          item={copySource}
          scope={scope}
          environments={environments}
          showOrgLevel={showOrgLevel}
          items={items}
          onClose={() => setCopySource(null)}
        />
      ) : null}

      {deleteRow ? (
        <ConfirmDialog
          title={`Delete "${deleteRow.name}" from all ${deleteRow.targets.length} scopes?`}
          description={
            <>
              This removes the {deleteRow.kind} <span className="font-mono text-text">{deleteRow.name}</span> from every
              scope below. This can&rsquo;t be undone.
              <ul className="mt-2 list-inside list-disc space-y-0.5">
                {deleteRow.targets.map((t) => (
                  <li key={`${t.level}:${t.scope.env ?? ''}`} className="font-mono text-xs">
                    {t.label}
                  </li>
                ))}
              </ul>
            </>
          }
          confirmLabel="Delete everywhere"
          error={deleteError}
          confirming={deleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            setDeleteRow(null)
            setDeleteError(null)
          }}
        />
      ) : null}
    </div>
  )
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
    </svg>
  )
}
