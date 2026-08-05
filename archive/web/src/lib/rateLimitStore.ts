import { useSyncExternalStore } from 'react'
import type { RateLimitInfo } from '../api/types'

let state: RateLimitInfo | null = null
const listeners = new Set<() => void>()

export function setRateLimit(info: RateLimitInfo) {
  state = info
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function useRateLimit() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
