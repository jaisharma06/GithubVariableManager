import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { fetchOAuthClientId } from './githubOAuth'
import { OAuthDeviceFlow } from './OAuthDeviceFlow'
import { Button } from '../components/Button'

type Tab = 'pat' | 'oauth'

export function ConnectScreen() {
  const [tab, setTab] = useState<Tab>('pat')
  const [tokenInput, setTokenInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [oauthClientId, setOauthClientId] = useState<string | null | 'loading'>('loading')
  const { connectWithToken } = useAuth()
  const navigate = useNavigate()
  const tokenFieldId = useId()

  useEffect(() => {
    fetchOAuthClientId()
      .then(setOauthClientId)
      .catch(() => setOauthClientId(null))
  }, [])

  async function handlePatSubmit(e: FormEvent) {
    e.preventDefault()
    if (!tokenInput.trim()) return
    setConnecting(true)
    setError(null)
    try {
      await connectWithToken(tokenInput.trim(), 'pat')
      navigate('/', { replace: true })
    } catch {
      setError('GitHub rejected this token — check that it hasn’t expired and that it carries repo and admin:org scopes.')
    } finally {
      setConnecting(false)
    }
  }

  async function handleOAuthSuccess(token: string) {
    await connectWithToken(token, 'oauth')
    navigate('/', { replace: true })
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink px-4">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-0 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-brand/10 blur-3xl" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(var(--color-line) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
            maskImage: 'radial-gradient(ellipse 60% 55% at 50% 35%, black 35%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 60% 55% at 50% 35%, black 35%, transparent 100%)',
          }}
        />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-7 text-center">
          <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand font-display text-base font-bold text-on-brand">
            G
          </span>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-text">Variables Manager</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-text-dim">
            One login, every GitHub Actions variable and secret — organization, repository, and environment — in a
            single view.
          </p>
        </div>

        <div className="rounded-xl border border-line bg-panel shadow-xl shadow-black/[0.04]">
          <div className="flex border-b border-line">
            <TabButton active={tab === 'pat'} onClick={() => setTab('pat')}>
              Personal access token
            </TabButton>
            <TabButton active={tab === 'oauth'} onClick={() => setTab('oauth')}>
              GitHub OAuth
            </TabButton>
          </div>

          {tab === 'pat' ? (
            <form onSubmit={handlePatSubmit} className="space-y-3 p-5">
              <label htmlFor={tokenFieldId} className="block text-xs font-medium text-text-dim">
                Fine-grained or classic token
              </label>
              <input
                id={tokenFieldId}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="ghp_..."
                className="w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-text placeholder:text-text-dim/60 focus:border-brand focus:outline-none"
              />
              <p className="text-xs text-text-dim">
                Needs <code className="text-brand">repo</code> and <code className="text-brand">admin:org</code>{' '}
                scopes to read and write variables/secrets at every level. Held only in this tab&rsquo;s session storage
                &mdash; never written to disk.
              </p>
              {error ? <p className="text-xs text-danger">{error}</p> : null}
              <Button type="submit" variant="primary" className="w-full" disabled={connecting || !tokenInput.trim()}>
                {connecting ? 'Connecting…' : 'Connect'}
              </Button>
            </form>
          ) : (
            <div className="space-y-3 p-5">
              {oauthClientId === 'loading' ? (
                <div className="h-9 animate-pulse rounded-md bg-panel-raised" />
              ) : oauthClientId ? (
                <>
                  <p className="text-xs text-text-dim">
                    Sign in with your GitHub account &mdash; no token to copy, no secret involved.
                  </p>
                  <OAuthDeviceFlow onSuccess={(token) => void handleOAuthSuccess(token)} />
                </>
              ) : (
                <p className="rounded-md border border-line bg-ink p-3 text-xs text-text-dim">
                  OAuth isn&rsquo;t configured on this server yet. Set{' '}
                  <code className="text-secret">GITHUB_OAUTH_CLIENT_ID</code> in <code>server/.env</code> (from an
                  OAuth App with Device Flow enabled), or use a personal access token instead.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
        active ? 'border-brand text-text' : 'border-transparent text-text-dim hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}
