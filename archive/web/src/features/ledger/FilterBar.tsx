import type { GithubEnvironment, ItemKind, ItemLevel } from '../../api/types'

export interface LedgerFilters {
  level: ItemLevel | 'all'
  kind: ItemKind | 'all'
  env: string | 'all'
  search: string
}

export const defaultFilters: LedgerFilters = { level: 'all', kind: 'all', env: 'all', search: '' }

interface FilterBarProps {
  filters: LedgerFilters
  onChange: (filters: LedgerFilters) => void
  environments: GithubEnvironment[]
  showRepoLevels: boolean
  showOrgLevel: boolean
}

export function FilterBar({ filters, onChange, environments, showRepoLevels, showOrgLevel }: FilterBarProps) {
  const levelOptions: { value: LedgerFilters['level']; label: string }[] = [
    { value: 'all', label: 'All levels' },
    ...(showOrgLevel ? [{ value: 'organization' as const, label: 'Organization' }] : []),
    ...(showRepoLevels ? [{ value: 'repository' as const, label: 'Repository' }] : []),
    ...(showRepoLevels ? [{ value: 'environment' as const, label: 'Environment' }] : []),
  ]

  const kindOptions: { value: LedgerFilters['kind']; label: string }[] = [
    { value: 'all', label: 'All types' },
    { value: 'variable', label: 'Variables' },
    { value: 'secret', label: 'Secrets' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <Pills value={filters.level} options={levelOptions} onChange={(level) => onChange({ ...filters, level })} />
      <Pills value={filters.kind} options={kindOptions} onChange={(kind) => onChange({ ...filters, kind })} />

      {showRepoLevels && environments.length > 0 ? (
        <select
          className="rounded-md border border-line bg-ink px-2.5 py-1.5 font-sans text-xs text-text-dim focus:border-brand focus:text-text focus:outline-none"
          value={filters.env}
          onChange={(e) => onChange({ ...filters, env: e.target.value })}
        >
          <option value="all">All environments</option>
          {environments.map((env) => (
            <option key={env.id} value={env.name}>
              {env.name}
            </option>
          ))}
        </select>
      ) : null}

      <input
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        placeholder="Filter by name&hellip;"
        className="ml-auto min-w-[10rem] rounded-md border border-line bg-ink px-2.5 py-1.5 font-mono text-xs text-text placeholder:text-text-dim/60 focus:border-brand focus:outline-none"
      />
    </div>
  )
}

function Pills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-line bg-ink p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`rounded px-2.5 py-1 font-sans text-xs font-medium transition-colors ${
            value === opt.value ? 'bg-brand-dim text-brand' : 'text-text-dim hover:text-text'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
