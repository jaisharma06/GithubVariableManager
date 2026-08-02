import { useMemo, useState } from 'react'
import type { GithubEnvironment, ItemKind, ItemLevel, LedgerItem } from '../../api/types'
import type { LedgerLockedSection, LedgerPartialError } from '../../api/hooks'
import { LedgerRow, LockedRow, ROW_GRID } from './LedgerRow'
import { SectionHeader } from './SectionHeader'
import { FilterBar, type LedgerFilters } from './FilterBar'
import { Button } from '../../components/Button'

interface LedgerProps {
  items: LedgerItem[]
  isLoading: boolean
  error: Error | null
  partialErrors?: LedgerPartialError[]
  lockedSections?: LedgerLockedSection[]
  environments: GithubEnvironment[]
  showRepoLevels: boolean
  showOrgLevel: boolean
  filters: LedgerFilters
  onFiltersChange: (filters: LedgerFilters) => void
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
  lockedKinds: ItemKind[]
}

function groupKeyFor(level: ItemLevel, env?: string): string {
  return level === 'environment' ? `env:${env}` : level
}

function descriptionFor(level: ItemLevel, scopeLabel: string, env?: string): string {
  if (level === 'organization') return `Shared with every repo in ${scopeLabel}.`
  if (level === 'repository') return 'Only this repo can use these.'
  return `Only deployments to "${env}" can use these.`
}

function groupItems(items: LedgerItem[], locked: LedgerLockedSection[]): Group[] {
  const groups = new Map<string, Group>()

  function ensureGroup(level: ItemLevel, scopeLabel: string, env?: string): Group {
    const key = groupKeyFor(level, env)
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        level,
        scopeLabel,
        description: descriptionFor(level, scopeLabel, env),
        env,
        items: [],
        lockedKinds: [],
      })
    }
    return groups.get(key)!
  }

  for (const item of items) {
    const scopeLabel = item.level === 'organization' ? item.scope.org : item.level === 'repository' ? item.scope.repo! : item.scope.env!
    ensureGroup(item.level, scopeLabel, item.scope.env).items.push(item)
  }

  for (const l of locked) {
    const g = ensureGroup(l.level, l.scopeLabel, l.env)
    if (!g.lockedKinds.includes(l.kind)) g.lockedKinds.push(l.kind)
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
  repository: 'ml-5',
  environment: 'ml-10',
}

export function Ledger({
  items,
  isLoading,
  error,
  partialErrors = [],
  lockedSections = [],
  environments,
  showRepoLevels,
  showOrgLevel,
  filters,
  onFiltersChange,
  onAdd,
  onAddToSection,
  onEdit,
  onDelete,
}: LedgerProps) {
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

  const filteredLocked = useMemo(() => {
    if (filters.search) return []
    return lockedSections.filter((l) => {
      if (filters.level !== 'all' && l.level !== filters.level) return false
      if (filters.kind !== 'all' && l.kind !== filters.kind) return false
      if (filters.env !== 'all' && l.env !== filters.env) return false
      return true
    })
  }, [lockedSections, filters])

  const groups = useMemo(() => groupItems(filtered, filteredLocked), [filtered, filteredLocked])

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-sm shadow-black/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar
          filters={filters}
          onChange={onFiltersChange}
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
              hideValues ? 'border-brand bg-brand-dim text-brand' : 'border-line text-text-dim hover:text-text'
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
        <div className="border-b border-line bg-danger-dim px-4 py-2">
          <p className="font-sans text-xs font-medium text-danger">
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
            <p className="font-display text-sm font-semibold text-danger">Couldn&rsquo;t load this scope</p>
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
          <div className="min-w-[46rem]">
            <div
              className={`${ROW_GRID} border-b border-line px-0 py-1.5 font-sans text-[11px] font-medium uppercase tracking-wider text-text-dim`}
            >
              <span />
              <span className="px-3">Type</span>
              <span className="px-1">Name</span>
              <span className="px-3">Value</span>
              <span className="px-3">Access</span>
              <span className="px-3" />
            </div>

            <div className="space-y-5 p-4">
              {groups.map((group) => (
                <div key={group.key} className={levelIndent[group.level]}>
                  <SectionHeader
                    level={group.level}
                    scopeLabel={group.scopeLabel}
                    description={group.description}
                    onAdd={() => onAddToSection(group.level, group.env)}
                  />
                  <div className="mt-1.5 overflow-hidden rounded-lg border border-line">
                    {group.items.map((item) => (
                      <LedgerRow
                        key={item.id}
                        item={item}
                        hideValues={hideValues}
                        onEdit={() => onEdit(item)}
                        onDelete={() => onDelete(item)}
                      />
                    ))}
                    {group.lockedKinds.map((kind) => (
                      <LockedRow key={kind} kind={kind} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.6 20.6 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a20.6 20.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  )
}
