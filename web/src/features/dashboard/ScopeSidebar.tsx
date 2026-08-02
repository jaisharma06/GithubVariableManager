import type { ReactNode } from 'react'
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
}

export function ScopeSidebar({ org, repo, environments, showOrgLevel, filters, onNavigate }: ScopeSidebarProps) {
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
          {environments.length > 0 ? (
            <div className="ml-4 space-y-0.5 border-l border-line pl-3">
              {environments.map((env) => (
                <TreeItem
                  key={env.id}
                  active={filters.level === 'environment' && filters.env === env.name}
                  label={env.name}
                  icon={<EnvIcon />}
                  onClick={() => onNavigate('environment', env.name)}
                />
              ))}
            </div>
          ) : null}
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
