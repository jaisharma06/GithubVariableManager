import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { GithubEnvironment } from '../../api/types'
import type { LedgerFilters } from '../ledger/FilterBar'

interface ScopeSidebarProps {
  org: string
  repo?: string
  environments: GithubEnvironment[]
  showOrgLevel: boolean
  filters: LedgerFilters
  onNavigate: (level: LedgerFilters['level'], env?: string) => void
  onCreateEnvironment: (name: string) => Promise<void>
  onDeleteEnvironment: (name: string) => void
}

export function ScopeSidebar({
  org,
  repo,
  environments,
  showOrgLevel,
  filters,
  onNavigate,
  onCreateEnvironment,
  onDeleteEnvironment,
}: ScopeSidebarProps) {
  return (
    <nav aria-label="Scope" className="space-y-0.5">
      <p className="mb-2 px-2 font-mono text-[11px] uppercase tracking-wider text-text-dim">Scope</p>

      <TreeItem active={filters.level === 'all'} label="Everything" onClick={() => onNavigate('all')} />

      {showOrgLevel ? (
        <TreeItem
          active={filters.level === 'organization'}
          label="Organization"
          meta={org}
          icon={<OrgIcon />}
          onClick={() => onNavigate('organization')}
        />
      ) : null}

      {repo ? (
        <>
          <TreeItem
            active={filters.level === 'repository'}
            label="Repository"
            meta={repo}
            icon={<RepoIcon />}
            onClick={() => onNavigate('repository')}
          />
          <div className="ml-4 space-y-0.5 border-l border-line pl-3">
            {environments.map((env) => (
              <EnvironmentItem
                key={env.id}
                active={filters.level === 'environment' && filters.env === env.name}
                label={env.name}
                onClick={() => onNavigate('environment', env.name)}
                onDelete={() => onDeleteEnvironment(env.name)}
              />
            ))}
            <NewEnvironmentForm onCreate={onCreateEnvironment} />
          </div>
        </>
      ) : null}

      <div className="pt-3">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-dim hover:bg-panel-raised hover:text-text"
        >
          <SwitchIcon />
          Switch scope
        </Link>
      </div>
    </nav>
  )
}

function TreeItem({
  active,
  label,
  meta,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  meta?: string
  icon?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
        active ? 'bg-brand-dim font-medium text-brand' : 'text-text-dim hover:bg-panel-raised hover:text-text'
      }`}
    >
      {icon ? <span className="shrink-0 opacity-80">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">
        {label}
        {meta ? <span className="ml-1 truncate opacity-70">&middot; {meta}</span> : null}
      </span>
    </button>
  )
}

function EnvironmentItem({
  active,
  label,
  onClick,
  onDelete,
}: {
  active: boolean
  label: string
  onClick: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={`group flex items-center rounded-md transition-colors ${
        active ? 'bg-brand-dim' : 'hover:bg-panel-raised'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'true' : undefined}
        className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm ${
          active ? 'font-medium text-brand' : 'text-text-dim group-hover:text-text'
        }`}
      >
        <span className="shrink-0 opacity-80">
          <EnvIcon />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        title={`Delete environment "${label}"`}
        className="mr-1 shrink-0 rounded p-1 text-text-dim opacity-0 hover:text-danger group-hover:opacity-100"
      >
        <TrashIcon />
      </button>
    </div>
  )
}

function NewEnvironmentForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setOpen(false)
    setName('')
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await onCreate(name.trim())
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub rejected this request.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text-dim hover:bg-panel-raised hover:text-text"
      >
        <PlusIcon />
        New environment
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5 px-1 py-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
        }}
        placeholder="production"
        spellCheck={false}
        className="w-full rounded-md border border-line bg-ink px-2 py-1 font-mono text-xs text-text placeholder:text-text-dim/60 focus:border-brand focus:outline-none"
      />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="rounded-md bg-brand px-2 py-1 text-xs font-medium text-on-brand disabled:opacity-40"
        >
          {submitting ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded-md px-2 py-1 text-xs text-text-dim hover:text-text"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function OrgIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function RepoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  )
}

function EnvIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="m12 2 9 4.9v10.2L12 22l-9-4.9V6.9L12 2Z" />
      <path d="M12 22v-9.1M3 6.9l9 5 9-5" />
    </svg>
  )
}

function SwitchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M7 16V4M7 4 3 8M7 4l4 4" />
      <path d="M17 8v12M17 20l4-4M17 20l-4-4" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
    </svg>
  )
}
