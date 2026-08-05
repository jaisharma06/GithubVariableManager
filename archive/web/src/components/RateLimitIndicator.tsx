import { useRateLimit } from '../lib/rateLimitStore'

export function RateLimitIndicator() {
  const rateLimit = useRateLimit()
  if (!rateLimit) return null

  const low = rateLimit.remaining < rateLimit.limit * 0.1
  const resetLabel = rateLimit.resetAt
    ? new Date(rateLimit.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <span
      className={`font-mono text-xs ${low ? 'text-danger' : 'text-text-dim'}`}
      title={resetLabel ? `Resets ${resetLabel}` : undefined}
    >
      {rateLimit.remaining}/{rateLimit.limit} API calls left
    </span>
  )
}
