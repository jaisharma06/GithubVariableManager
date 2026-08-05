import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useCopyItem, useCreateEnvironment, useDeleteEnvironment } from '../../api/hooks'
import type { GithubEnvironment, LedgerItem, ScopeRef } from '../../api/types'
import { Button } from '../../components/Button'

interface RenameEnvironmentDialogProps {
  org: string
  repo: string
  oldName: string
  environments: GithubEnvironment[]
  /** The full ledger — used to find what's currently set in this environment. */
  items: LedgerItem[]
  onClose: () => void
  onRenamed: (oldName: string, newName: string) => void
}

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/

export function RenameEnvironmentDialog({
  org,
  repo,
  oldName,
  environments,
  items,
  onClose,
  onRenamed,
}: RenameEnvironmentDialogProps) {
  const { token } = useAuth()
  const createEnvironment = useCreateEnvironment(token)
  const deleteEnvironment = useDeleteEnvironment(token)
  const { copyTo, isPending: copyPending } = useCopyItem(token)

  const [newName, setNewName] = useState(oldName)
  const [deleteOldAnyway, setDeleteOldAnyway] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'idle' | 'creating' | 'copying' | 'deleting'>('idle')

  const variables = useMemo(
    () => items.filter((i) => i.kind === 'variable' && i.level === 'environment' && i.scope.env === oldName),
    [items, oldName],
  )
  const secrets = useMemo(
    () => items.filter((i) => i.kind === 'secret' && i.level === 'environment' && i.scope.env === oldName),
    [items, oldName],
  )

  const submitting = step !== 'idle' || createEnvironment.isPending || deleteEnvironment.isPending || copyPending
  const trimmed = newName.trim()
  const nameValid = trimmed.length === 0 || NAME_PATTERN.test(trimmed)
  const canDeleteOld = secrets.length === 0 || deleteOldAnyway

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!trimmed || !NAME_PATTERN.test(trimmed)) {
      setError('Enter a valid environment name.')
      return
    }
    if (trimmed === oldName) {
      setError('Choose a different name.')
      return
    }
    if (environments.some((env) => env.name === trimmed)) {
      setError('An environment with this name already exists.')
      return
    }
    // If secrets exist and the user hasn't checked "delete anyway", we still create the new
    // environment and copy variables below — we just skip deleting the old one afterward.

    try {
      setStep('creating')
      await createEnvironment.mutateAsync({ org, repo, name: trimmed })

      if (variables.length > 0) {
        setStep('copying')
        const newScope: ScopeRef = { org, repo, env: trimmed }
        const outcomes = await Promise.all(
          variables.map((v) => copyTo('variable', v.name, v.value ?? '', [{ level: 'environment', scope: newScope, exists: false }])),
        )
        const failed = outcomes.flat().filter((r) => !r.ok)
        if (failed.length > 0) {
          setError(
            `Created "${trimmed}", but ${failed.length} of ${variables.length} variable(s) failed to copy: ${failed
              .map((f) => f.message)
              .join('; ')}. The old environment "${oldName}" was left in place — fix and retry, or copy them manually.`,
          )
          setStep('idle')
          return
        }
      }

      if (canDeleteOld) {
        setStep('deleting')
        await deleteEnvironment.mutateAsync({ org, repo, name: oldName })
      }

      onRenamed(oldName, trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub rejected this request.')
      setStep('idle')
    }
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
        className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/10"
      >
        <div className="border-b border-line px-5 py-4">
          <p className="font-mono text-xs uppercase tracking-widest text-brand">Rename</p>
          <h2 className="mt-1 font-display text-lg font-semibold text-text">{oldName}</h2>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-xs text-text-dim">
            GitHub has no rename API for environments — this creates{' '}
            <span className="font-mono text-text">{trimmed || '…'}</span>, copies over{' '}
            {variables.length === 0 ? 'nothing' : `${variables.length} variable${variables.length === 1 ? '' : 's'}`}, then
            removes <span className="font-mono text-text">{oldName}</span>.
          </p>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dim">New name</span>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              spellCheck={false}
              className="w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-text placeholder:text-text-dim/60 focus:border-brand focus:outline-none"
            />
            {!nameValid ? <p className="mt-1 text-xs text-danger">Letters, numbers, underscores, dots, and hyphens only.</p> : null}
          </label>

          {secrets.length > 0 ? (
            <div className="space-y-2 rounded-md border border-danger/30 bg-danger-dim p-3">
              <p className="text-xs font-medium text-danger">
                {secrets.length} secret{secrets.length === 1 ? '' : 's'} can&rsquo;t be carried over
              </p>
              <p className="text-xs text-text-dim">
                GitHub never returns a secret&rsquo;s stored value, so it can&rsquo;t be read and copied. Re-add{' '}
                {secrets.map((s) => s.name).join(', ')} under the new name after renaming.
              </p>
              <label className="flex items-start gap-2 text-xs text-text">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={deleteOldAnyway}
                  onChange={(e) => setDeleteOldAnyway(e.target.checked)}
                />
                <span>
                  Delete <span className="font-mono">{oldName}</span> now anyway — I understand its secrets will be lost.
                </span>
              </label>
              {!deleteOldAnyway ? (
                <p className="text-xs text-text-dim">
                  Otherwise <span className="font-mono">{oldName}</span> is left in place so you can finish moving secrets over,
                  then delete it yourself.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting || !trimmed}>
            {step === 'creating'
              ? 'Creating…'
              : step === 'copying'
                ? 'Copying variables…'
                : step === 'deleting'
                  ? 'Cleaning up…'
                  : 'Rename'}
          </Button>
        </div>
      </form>
    </div>
  )
}
