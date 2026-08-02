import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { getViewer } from '../api/scopes'
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

const STORAGE_KEY = 'ghvm.session'

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredSession(): StoredSession | null {
  const raw = sessionStorage.getItem(STORAGE_KEY)
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
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSession(next)
  }, [])

  const disconnect = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    setSession(null)
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
