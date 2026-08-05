import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { sameScope, useCopyItem, type CopyResult, type DashboardScope } from '../../api/hooks'
import type { GithubEnvironment, ItemLevel, LedgerItem, ScopeRef } from '../../api/types'
import { Button } from '../../components/Button'

interface CopyItemDialogProps {
  item: LedgerItem
  scope: DashboardScope
  environments: GithubEnvironment[]
  showOrgLevel: boolean
  /** The full ledger — used to tell which destinations already have this name (create vs. update, and a same/different-value hint). */
  items: LedgerItem[]
  onClose: () => void
}

interface Candidate {
  key: string
  label: string
  level: ItemLevel
  scope: ScopeRef
  existing?: LedgerItem
}

/** Every other scope in this repo/org that could receive a copy of `source`. */
function buildCandidates(
  source: LedgerItem,
  scope: DashboardScope,
  environments: GithubEnvironment[],
  showOrgLevel: boolean,
  items: LedgerItem[],
): Candidate[] {
  const list: Candidate[] = []
  if (showOrgLevel) {
    list.push({ key: 'organization', label: `Organization · ${scope.org}`, level: 'organization', scope: { org: scope.org } })
  }
  if (scope.repo) {
    list.push({ key: 'repository', label: `Repository · ${scope.repo}`, level: 'repository', scope: { org: scope.org, repo: scope.repo } })
    for (const env of environments) {
      list.push({
        key: `env:${env.name}`,
        label: env.name,
        level: 'environment',
        scope: { org: scope.org, repo: scope.repo, env: env.name },
      })
    }
  }

  return list
    .filter((c) => !(c.level === source.level && sameScope(c.scope, source.scope)))
    .map((c) => ({
      ...c,
      existing: items.find(
        (i) => i.kind === source.kind && i.level === c.level && i.name === source.name && sameScope(i.scope, c.scope),
      ),
    }))
}

export function CopyItemDialog({ item, scope, environments, showOrgLevel, items, onClose }: CopyItemDialogProps) {
  const { token } = useAuth()
  const { copyTo, isPending } = useCopyItem(token)
  const isSecret = item.kind === 'secret'

  const candidates = useMemo(
    () => buildCandidates(item, scope, environments, showOrgLevel, items),
    [item, scope, environments, showOrgLevel, items],
  )

  const [value, setValue] = useState(item.kind === 'variable' ? (item.value ?? '') : '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [failures, setFailures] = useState<{ label: string; message: string }[] | null>(null)

  const allSelected = candidates.length > 0 && selected.size === candidates.length

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(candidates.map((c) => c.key)))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setFailures(null)

    if (selected.size === 0) {
      setError('Choose at least one destination.')
      return
    }
    if (isSecret && !value) {
      setError('Enter the value to push — GitHub never returns a secret’s stored value, so it can’t be read and copied automatically.')
      return
    }

    const targets = candidates
      .filter((c) => selected.has(c.key))
      .map((c) => ({ level: c.level, scope: c.scope, exists: !!c.existing }))

    const outcome = await copyTo(item.kind, item.name, value, targets)
    if (outcome.every((r) => r.ok)) {
      onClose()
      return
    }
    setFailures(
      outcome
        .filter((r) => !r.ok)
        .map((r) => ({ label: labelFor(candidates, r), message: r.message ?? 'Unknown error' })),
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/10"
      >
        <div className="border-b border-line px-5 py-4">
          <p className="font-mono text-xs uppercase tracking-widest text-brand">Copy</p>
          <h2 className="mt-1 font-display text-lg font-semibold text-text">{item.name}</h2>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dim">
              {isSecret ? 'Value to push (write-only — can’t be read back from GitHub)' : 'Value'}
            </span>
            <textarea
              autoFocus
              rows={3}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              spellCheck={false}
              placeholder={isSecret ? 'Enter the value to copy to the scopes below' : ''}
              className="w-full resize-y rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-text placeholder:text-text-dim/60 focus:border-brand focus:outline-none"
            />
          </label>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-text-dim">Copy to</span>
              {candidates.length > 0 ? (
                <button type="button" onClick={toggleAll} className="text-xs text-brand hover:underline">
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
              ) : null}
            </div>
            {candidates.length === 0 ? (
              <p className="text-xs text-text-dim">No other scopes available to copy into.</p>
            ) : (
              <div className="max-h-52 space-y-0 overflow-y-auto rounded-md border border-line">
                {candidates.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-sm last:border-b-0"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)} />
                      <span className="truncate text-text">{c.label}</span>
                    </span>
                    {!c.existing ? (
                      <span className="shrink-0 text-xs text-text-dim">not set</span>
                    ) : isSecret ? (
                      <span className="shrink-0 text-xs text-text-dim">already set</span>
                    ) : c.existing.value === value ? (
                      <span className="shrink-0 text-xs text-ok">already matches</span>
                    ) : (
                      <span className="shrink-0 text-xs text-danger">will overwrite</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          {failures ? (
            <div className="space-y-1 rounded-md border border-danger/30 bg-danger-dim p-2.5">
              <p className="text-xs font-medium text-danger">
                Copied to {selected.size - failures.length} of {selected.size} — these failed:
              </p>
              {failures.map((f) => (
                <p key={f.label} className="text-xs text-text-dim">
                  <span className="text-danger">{f.label}</span>: {f.message}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {failures ? 'Close' : 'Cancel'}
          </Button>
          <Button type="submit" variant="primary" disabled={isPending || candidates.length === 0}>
            {isPending ? 'Copying…' : selected.size > 0 ? `Copy to ${selected.size} ${selected.size === 1 ? 'scope' : 'scopes'}` : 'Copy'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function labelFor(candidates: Candidate[], result: CopyResult): string {
  const match = candidates.find((c) => c.level === result.target.level && sameScope(c.scope, result.target.scope))
  return match?.label ?? result.target.level
}
