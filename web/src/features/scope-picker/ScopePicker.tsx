import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useMyOrgs, useMyRepos } from '../../api/hooks'

export function ScopePicker() {
  const { viewer, disconnect } = useAuth()
  const { token } = useAuth()
  const orgsQuery = useMyOrgs(token)
  const reposQuery = useMyRepos(token)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const orgs = useMemo(
    () => (orgsQuery.data ?? []).filter((o) => o.login.toLowerCase().includes(query.toLowerCase())),
    [orgsQuery.data, query],
  )
  const repos = useMemo(
    () => (reposQuery.data ?? []).filter((r) => r.fullName.toLowerCase().includes(query.toLowerCase())),
    [reposQuery.data, query],
  )

  const loading = orgsQuery.isLoading || reposQuery.isLoading

  return (
    <div className="min-h-screen bg-ink">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-variable"># github-variables-manager</p>
          <h1 className="mt-1 font-sans text-lg font-semibold text-text">Pick a scope</h1>
        </div>
        <div className="flex items-center gap-3 text-sm text-text-dim">
          {viewer ? <span>Connected as {viewer.login}</span> : null}
          <button onClick={disconnect} className="text-secret hover:underline">
            Disconnect
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search organizations and repositories&hellip;"
          className="w-full rounded-md border border-line bg-panel px-3 py-2 font-mono text-sm text-text placeholder:text-text-dim/60 focus:border-variable focus:outline-none"
        />

        {loading ? (
          <div className="mt-6 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-md bg-panel" />
            ))}
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <Section
              title="Organizations"
              helper="Shows every variable and secret shared org-wide."
              empty="No organizations matched."
            >
              {orgs.map((org) => (
                <Row key={org.login} label={org.login} onClick={() => navigate(`/o/${org.login}`)} />
              ))}
            </Section>

            <Section
              title="Repositories"
              helper="Shows this repo's own variables/secrets, plus its organization's and every deployment environment's."
              empty="No repositories matched."
            >
              {repos.map((repo) => (
                <Row
                  key={repo.fullName}
                  label={repo.fullName}
                  meta={repo.private ? 'private' : 'public'}
                  onClick={() => navigate(`/r/${repo.owner}/${repo.name}`)}
                />
              ))}
            </Section>
          </div>
        )}
      </main>
    </div>
  )
}

function Section({
  title,
  helper,
  empty,
  children,
}: {
  title: string
  helper: string
  empty: string
  children: ReactNode
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children
  return (
    <section>
      <p className="font-mono text-xs uppercase tracking-widest text-text-dim">{title}</p>
      <p className="mb-2 mt-0.5 text-xs text-text-dim">{helper}</p>
      {hasChildren ? (
        <div className="overflow-hidden rounded-md border border-line">{children}</div>
      ) : (
        <p className="text-sm text-text-dim">{empty}</p>
      )}
    </section>
  )
}

function Row({ label, meta, onClick }: { label: string; meta?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between border-b border-line bg-panel px-4 py-3 text-left last:border-b-0 hover:bg-panel-raised"
    >
      <span className="font-mono text-sm text-text">{label}</span>
      <span className="flex items-center gap-3">
        {meta ? <span className="text-xs text-text-dim">{meta}</span> : null}
        <span className="text-text-dim">&rarr;</span>
      </span>
    </button>
  )
}
