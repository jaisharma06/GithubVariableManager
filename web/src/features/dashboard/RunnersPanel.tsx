import { useAuth } from '../../auth/AuthContext'
import { GitHubApiError } from '../../api/client'
import { useRunners, type DashboardScope } from '../../api/hooks'
import type { Runner } from '../../api/runners'

export function RunnersPanel({ scope }: { scope: DashboardScope }) {
  const { token } = useAuth()
  const runnersQuery = useRunners(token, scope)
  const runners = runnersQuery.data ?? []
  const err = runnersQuery.error

  const noAccess = err instanceof GitHubApiError && (err.status === 403 || err.status === 404)
  const onlineCount = runners.filter((r) => r.status === 'online').length

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-text-dim">Runners</p>
        {runners.length > 0 ? (
          <span className="font-mono text-[10px] text-text-dim">
            {onlineCount}/{runners.length} online
          </span>
        ) : null}
      </div>

      {runnersQuery.isLoading ? (
        <div className="space-y-1 px-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-6 animate-pulse rounded-md bg-panel-raised" />
          ))}
        </div>
      ) : noAccess ? (
        <p className="px-2 text-xs text-text-dim">No access to view runners here.</p>
      ) : err ? (
        <p className="px-2 text-xs text-danger">{err instanceof Error ? err.message : 'Couldn’t load runners.'}</p>
      ) : runners.length === 0 ? (
        <p className="px-2 text-xs text-text-dim">No self-hosted runners assigned.</p>
      ) : (
        <div className="max-h-56 space-y-0.5 overflow-y-auto px-1">
          {runners.map((r) => (
            <RunnerRow key={r.id} runner={r} />
          ))}
        </div>
      )}
    </div>
  )
}

function RunnerRow({ runner }: { runner: Runner }) {
  const state = runner.status !== 'online' ? 'offline' : runner.busy ? 'busy' : 'online'
  const dotClass = state === 'online' ? 'bg-ok' : state === 'busy' ? 'bg-variable' : 'bg-text-dim'
  const labelClass = state === 'online' ? 'text-ok' : state === 'busy' ? 'text-variable' : 'text-text-dim'
  const labels = runner.labels.map((l) => l.name).join(', ')

  return (
    <div
      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-panel-raised"
      title={labels ? `${runner.os} · ${labels}` : runner.os}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-text">{runner.name}</span>
      <span className={`shrink-0 font-mono text-[10px] uppercase tracking-wide ${labelClass}`}>{state}</span>
    </div>
  )
}
