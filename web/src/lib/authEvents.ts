// Fired by the API client whenever GitHub rejects the stored token (401), so the
// auth layer can react (clear the session, bounce to /connect) without a direct
// import cycle between api/client.ts and auth/AuthContext.tsx.

type Listener = () => void
const listeners = new Set<Listener>()

export function notifyUnauthorized() {
  listeners.forEach((l) => l())
}

export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
