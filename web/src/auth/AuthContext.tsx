import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getViewer } from '../api/scopes'
import { onUnauthorized } from '../lib/authEvents'
import type { Viewer } from '../api/types'

type AuthMethod = 'pat' | 'oauth'

interface StoredSession {
  token: string
  method: AuthMethod
  viewer: Viewer
}

interface AuthContextValue {
  token: string | null
  method: AuthMethod | null
  viewer: Viewer | null
  connectWithToken: (token: string, method?: AuthMethod) => Promise<void>
  disconnect: () => void
}

// localStorage (not sessionStorage) so the session survives closing the tab/browser —
// the user stays signed in until they disconnect or GitHub rejects the token.
const STORAGE_KEY = 'ghvm.session'

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredSession(): StoredSession | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession())

  const connectWithToken = useCallback(async (token: string, method: AuthMethod = 'pat') => {
    const viewer = await getViewer(token)
    const next: StoredSession = { token, method, viewer }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSession(next)
  }, [])

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setSession(null)
  }, [])

  // If GitHub ever rejects the stored token (expired/revoked), drop the session so
  // RequireAuth bounces the user back to /connect instead of failing silently.
  useEffect(() => onUnauthorized(disconnect), [disconnect])

  // Keep multiple tabs in sync: signing out (or in) in one tab reflects in the others,
  // since they now share the same localStorage-backed session.
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return
      try {
        setSession(e.newValue ? (JSON.parse(e.newValue) as StoredSession) : null)
      } catch {
        setSession(null)
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      token: session?.token ?? null,
      method: session?.method ?? null,
      viewer: session?.viewer ?? null,
      connectWithToken,
      disconnect,
    }),
    [session, connectWithToken, disconnect],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
