import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import type { ReactNode } from 'react'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  if (!token) return <Navigate to="/connect" replace />
  return <>{children}</>
}
