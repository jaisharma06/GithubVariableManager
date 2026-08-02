import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../../auth/AuthContext'
import {
  useCreateVariable,
  useOrgRepos,
  usePutSecret,
  useRenameSecret,
  useUpdateVariable,
  type DashboardScope,
} from '../../api/hooks'
import type { GithubEnvironment, ItemKind, ItemLevel, LedgerItem, ScopeRef, SecretVisibility } from '../../api/types'
import type { PutSecretOptions } from '../../api/secrets'
import { Button } from '../../components/Button'

interface ItemEditorPanelProps {
  scope: DashboardScope
  environments: GithubEnvironment[]
  initial: LedgerItem | null
  /** Pre-fill the level/environment when opened from a section's own "+ Add" button. */
  initialLevel?: ItemLevel
  initialEnv?: string
  showOrgLevel: boolean
  onClose: () => void
}

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function ItemEditorPanel({
  scope,
  environments,
  initial,
  initialLevel,
  initialEnv,
  showOrgLevel,
  onClose,
}: ItemEditorPanelProps) {
  const isEdit = !!initial
  const { token } = useAuth()

  const [level, setLevel] = useState<ItemLevel>(
    initial?.level ?? initialLevel ?? (scope.repo ? 'repository' : 'organization'),
  )
  const [envName, setEnvName] = useState<string>(
    initial?.scope.env ?? initialEnv ?? environments[0]?.name ?? '',
  )
  const [kind, setKind] = useState<ItemKind>(initial?.kind ?? 'variable')
  const [name, setName] = useState(initial?.name ?? '')
  const [value, setValue] = useState(initial?.kind === 'variable' ? (initial.value ?? '') : '')
  const [visibility, setVisibility] = useState<SecretVisibility>(initial?.visibility ?? 'all')
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const createVariable = useCreateVariable(token)
  const updateVariable = useUpdateVariable(token)
  const putSecret = usePutSecret(token)
  const renameSecret = useRenameSecret(token)
  const submitting =
    createVariable.isPending || updateVariable.isPending || putSecret.isPending || renameSecret.isPending

  const needsVisibilityPicker = kind === 'secret' && level === 'organization'
  const orgReposQuery = useOrgRepos(token, scope.org, needsVisibilityPicker && visibility === 'selected')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const nameValid = name.length === 0 || NAME_PATTERN.test(name)

  const targetScope = useMemo<ScopeRef>(() => {
    if (level === 'organization') return { org: scope.org }
    if (level === 'repository') return { org: scope.org, repo: scope.repo }
    return { org: scope.org, repo: scope.repo, env: envName }
  }, [level, scope, envName])

  const isRenaming = isEdit && name !== initial!.name

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim() || !NAME_PATTERN.test(name)) {
      setError('Name must start with a letter or underscore and contain only letters, numbers, and underscores.')
      return
    }
    if (level === 'environment' && !envName) {
      setError('Choose an environment.')
      return
    }
    if (kind === 'variable' && !value.trim()) {
      setError('Enter a value for this variable.')
      return
    }
    if (kind === 'secret' && (!isEdit || isRenaming) && !value) {
      setError(
        isRenaming
          ? 'Enter a value — GitHub can’t copy a secret’s value when renaming it, so you’ll need to re-enter it under the new name.'
          : 'Enter a value for this secret.',
      )
      return
    }

    try {
      if (kind === 'variable') {
        if (isEdit) {
          await updateVariable.mutateAsync({ scope: targetScope, level, currentName: initial!.name, newName: name, value })
        } else {
          await createVariable.mutateAsync({ scope: targetScope, level, name, value })
        }
      } else {
        const options: PutSecretOptions | undefined =
          level === 'organization' ? { visibility, selectedRepositoryIds: [...selectedRepoIds] } : undefined

        if (isEdit && isRenaming) {
          await renameSecret.mutateAsync({ scope: targetScope, level, currentName: initial!.name, newName: name, value, options })
        } else if (isEdit && !value) {
          onClose()
          return
        } else {
          await putSecret.mutateAsync({ scope: targetScope, level, name, value, options })
        }
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub rejected this request.')
    }
  }

  function toggleRepo(id: number) {
    setSelectedRepoIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[2px]" role="presentation" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-panel shadow-2xl shadow-black/10"
      >
        <div className="border-b border-line px-5 py-4">
          <p className="font-mono text-xs uppercase tracking-widest text-brand">{isEdit ? 'Edit' : 'Add'}</p>
          <h2 className="mt-1 font-display text-lg font-semibold text-text">
            {isEdit ? initial!.name : 'New variable or secret'}
          </h2>
        </div>

        <div className="flex-1 space-y-4 px-5 py-4">
          <Field label="Level">
            {scope.repo && !isEdit ? (
              <select
                className={selectClass}
                value={level}
                onChange={(e) => setLevel(e.target.value as ItemLevel)}
              >
                {showOrgLevel && <option value="organization">Organization ({scope.org})</option>}
                <option value="repository">Repository ({scope.repo})</option>
                {environments.length > 0 && <option value="environment">Environment</option>}
              </select>
            ) : (
              <p className="font-mono text-sm text-text-dim">
                {level}
                {level === 'environment' ? `: ${envName}` : ''}
              </p>
            )}
          </Field>

          {!isEdit && level === 'environment' ? (
            <Field label="Environment">
              <select className={selectClass} value={envName} onChange={(e) => setEnvName(e.target.value)}>
                {environments.map((env) => (
                  <option key={env.id} value={env.name}>
                    {env.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label="Type">
            {isEdit ? (
              <p className="font-mono text-sm text-text-dim">{kind}</p>
            ) : (
              <div className="flex gap-2">
                <KindOption
                  label="Variable"
                  tone="variable"
                  active={kind === 'variable'}
                  onClick={() => setKind('variable')}
                />
                <KindOption
                  label="Secret"
                  tone="secret"
                  active={kind === 'secret'}
                  onClick={() => setKind('secret')}
                />
              </div>
            )}
          </Field>

          <Field label="Name">
            <input
              autoFocus={!isEdit}
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              placeholder="API_URL"
              spellCheck={false}
              className={inputClass}
            />
            {!nameValid ? (
              <p className="mt-1 text-xs text-danger">Letters, numbers, and underscores only.</p>
            ) : null}
            {isRenaming && kind === 'secret' ? (
              <p className="mt-1 text-xs text-text-dim">
                Secrets can&rsquo;t be renamed directly — this creates{' '}
                <span className="font-mono text-secret">{name || '…'}</span> with the value below, then deletes{' '}
                <span className="font-mono">{initial!.name}</span>.
              </p>
            ) : null}
          </Field>

          <Field label={kind === 'secret' ? 'Value (write-only — GitHub will never show it again)' : 'Value'}>
            <textarea
              autoFocus={isEdit}
              rows={3}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={isEdit && kind === 'secret' ? 'Enter a new value to replace the current one' : ''}
              spellCheck={false}
              className={`${inputClass} resize-y`}
            />
          </Field>

          {needsVisibilityPicker ? (
            <Field label="Which repos can use this?">
              <select
                className={selectClass}
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as SecretVisibility)}
              >
                <option value="all">All repositories</option>
                <option value="private">Private repositories</option>
                <option value="selected">Selected repositories</option>
              </select>
              {visibility === 'selected' ? (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-line">
                  {orgReposQuery.isLoading ? (
                    <p className="p-3 text-xs text-text-dim">Loading repositories&hellip;</p>
                  ) : (
                    (orgReposQuery.data ?? []).map((repo) => (
                      <label
                        key={repo.id}
                        className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm text-text last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedRepoIds.has(repo.id)}
                          onChange={() => toggleRepo(repo.id)}
                        />
                        <span className="font-mono text-xs">{repo.name}</span>
                      </label>
                    ))
                  )}
                </div>
              ) : null}
            </Field>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
          </Button>
        </div>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-text placeholder:text-text-dim/60 focus:border-brand focus:outline-none'
const selectClass = inputClass

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-dim">{label}</span>
      {children}
    </label>
  )
}

const kindToneClass: Record<'variable' | 'secret', string> = {
  variable: 'border-variable bg-variable-dim text-variable',
  secret: 'border-secret bg-secret-dim text-secret',
}

function KindOption({
  label,
  tone,
  active,
  onClick,
}: {
  label: string
  tone: 'variable' | 'secret'
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
        active ? kindToneClass[tone] : 'border-line text-text-dim hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}
