const KEY = 'ghvm.lastScope'

export interface LastScope {
  path: string
  label: string
}

export function setLastScope(scope: LastScope) {
  sessionStorage.setItem(KEY, JSON.stringify(scope))
}

export function getLastScope(): LastScope | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as LastScope
  } catch {
    return null
  }
}
