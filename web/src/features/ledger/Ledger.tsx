import { useMemo, useState } from 'react'
import type { GithubEnvironment, ItemLevel, LedgerItem } from '../../api/types'
import type { LedgerPartialError } from '../../api/hooks'
import { LedgerRow } from './LedgerRow'
import { SectionHeader } from './SectionHeader'
import { FilterBar, defaultFilters, type LedgerFilters } from './FilterBar'
import { Button } from '../../components/Button'

interface LedgerProps {
  items: LedgerItem[]
  isLoading: boolean
  error: Error | null
  partialErrors?: LedgerPartialError[]
  environments: GithubEnvironment[]
  showRepoLevels: boolean
  showOrgLevel: boolean
  onAdd: () => void
  onAddToSection: (level: ItemLevel, env?: string) => void
  onEdit: (item: LedgerItem) => void
  onDelete: (item: LedgerItem) => void
}

interface Group {
  key: string
  level: ItemLevel
  scopeLabel: string
  description: string
  env?: string
  items: LedgerItem[]
}

function groupItems(items: LedgerItem[]): Group[] {
  const groups = new Map<string, Group>()

  for (const item of items) {
    let key: string
    let scopeLabel: string
    let description: string

    if (item.level === 'organization') {
      key = 'org'
      scopeLabel = item.scope.org
      description = `Shared with every repo in ${item.scope.org}.`
    } else if (item.level === 'repository') {
      key = 'repo'
      scopeLabel = item.scope.repo!
      description = 'Only this repo can use these.'
    } else {
      key = `env:${item.scope.env}`
      scopeLabel = item.scope.env!
      description = `Only deployments to "${item.scope.env}" can use these.`
    }

    if (!groups.has(key)) {
      groups.set(key, { key, level: item.level, scopeLabel, description, env: item.scope.env, items: [] })
    }
    groups.get(key)!.items.push(item)
  }

  const order: Record<ItemLevel, number> = { organization: 0, repository: 1, environment: 2 }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      items: [...g.items].sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'variable' ? -1 : 1,
      ),
    }))
    .sort((a, b) => order[a.level] - order[b.level] || a.scopeLabel.localeCompare(b.scopeLabel))
}

const levelIndent: Record<ItemLevel, string> = {
  organization: 'ml-0',
  repository: 'ml-4',
  environment: 'ml-8',
}

export function Ledger({
  items,
  isLoading,
  error,
  partialErrors = [],
  environments,
  showRepoLevels,
  showOrgLevel,
  onAdd,
  onAddToSection,
  onEdit,
  onDelete,
}: LedgerProps) {
  const [filters, setFilters] = useState<LedgerFilters>(defaultFilters)
  const [hideValues, setHideValues] = useState(false)

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (filters.level !== 'all' && item.level !== filters.level) return false
      if (filters.kind !== 'all' && item.kind !== filters.kind) return false
      if (filters.env !== 'all' && item.scope.env !== filters.env) return false
      if (filters.search && !item.name.toLowerCase().includes(filters.search.toLowerCase())) return false
      return true
    })
  }, [items, filters])

  const groups = useMemo(() => groupItems(filtered), [filtered])

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          environments={environments}
          showRepoLevels={showRepoLevels}
          showOrgLevel={showOrgLevel}
        />
        <div className="mr-4 flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setHideValues((v) => !v)}
            aria-pressed={hideValues}
            title={hideValues ? 'Show variable values' : 'Hide variable values (e.g. before screen-sharing)'}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-sans text-xs font-medium transition-colors ${
              hideValues
                ? 'border-variable bg-variable-dim text-variable'
                : 'border-line text-text-dim hover:text-text'
            }`}
          >
            {hideValues ? <EyeOffIcon /> : <EyeIcon />}
            {hideValues ? 'Values hidden' : 'Hide values'}
          </button>
          <Button variant="primary" size="sm" onClick={onAdd}>
            + Add
          </Button>
        </div>
      </div>

      {partialErrors.length > 0 ? (
        <div className="border-b border-line bg-danger/10 px-4 py-2">
          <p className="font-mono text-xs text-danger">
            Couldn&rsquo;t load {partialErrors.length === 1 ? 'one part' : `${partialErrors.length} parts`} of this
            scope
          </p>
          <ul className="mt-1 space-y-0.5">
            {partialErrors.map((e) => (
              <li key={e.label} className="text-xs text-text-dim">
                <span className="text-danger">{e.label}</span>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded-md bg-panel-raised" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <p className="font-sans text-sm font-semibold text-danger">Couldn&rsquo;t load this scope</p>
            <p className="mt-2 text-sm text-text-dim">{error.message}</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-text-dim">
              {items.length === 0
                ? 'No variables or secrets set here yet — add one to get started.'
                : 'Nothing matches these filters — clear them to see everything in scope.'}
            </p>
          </div>
        ) : (
          <div className="min-w-[46rem] space-y-4 p-4">
            {groups.map((group) => (
              <div key={group.key} className={levelIndent[group.level]}>
                <SectionHeader
                  level={group.level}
                  scopeLabel={group.scopeLabel}
                  description={group.description}
                  onAdd={() => onAddToSection(group.level, group.env)}
                />
                <div className="mt-1.5 overflow-hidden rounded-md border border-line">
                  {group.items.map((item) => (
                    <LedgerRow key={item.id} item={item} hideValues={hideValues} onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.6 20.6 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a20.6 20.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  )
}
