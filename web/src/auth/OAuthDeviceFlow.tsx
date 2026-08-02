import { useEffect, useRef, useState } from 'react'
import { pollDeviceToken, startDeviceFlow, type DeviceCode } from './githubOAuth'
import { Button } from '../components/Button'

type State =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'waiting'; device: DeviceCode; copied: boolean }
  | { phase: 'error'; message: string }

interface OAuthDeviceFlowProps {
  onSuccess: (token: string) => void
}

export function OAuthDeviceFlow({ onSuccess }: OAuthDeviceFlowProps) {
  const [state, setState] = useState<State>({ phase: 'idle' })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deadlineRef = useRef<number>(0)
  const cancelledRef = useRef(false)

  useEffect(() => {
    // Reset on (re-)mount — StrictMode's dev-only mount→cleanup→remount cycle would
    // otherwise leave this permanently "cancelled" after the simulated first cleanup.
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function schedulePoll(device: DeviceCode, intervalSeconds: number) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void poll(device, intervalSeconds), intervalSeconds * 1000)
  }

  async function poll(device: DeviceCode, intervalSeconds: number) {
    if (cancelledRef.current) return

    if (Date.now() > deadlineRef.current) {
      setState({ phase: 'error', message: 'This code expired before it was approved. Try again.' })
      return
    }

    const result = await pollDeviceToken(device.deviceCode)
    if (cancelledRef.current) return

    switch (result.status) {
      case 'success':
        onSuccess(result.token)
        return
      case 'pending':
        schedulePoll(device, intervalSeconds)
        return
      case 'slow_down':
        schedulePoll(device, result.interval)
        return
      case 'denied':
        setState({ phase: 'error', message: 'Sign-in was declined on GitHub. Try again.' })
        return
      case 'expired':
        setState({ phase: 'error', message: 'This code expired. Try again.' })
        return
      case 'error':
        setState({ phase: 'error', message: result.message })
        return
    }
  }

  async function start() {
    setState({ phase: 'starting' })
    try {
      const device = await startDeviceFlow()
      if (cancelledRef.current) return
      deadlineRef.current = Date.now() + device.expiresIn * 1000

      setState({ phase: 'waiting', device, copied: false })
      schedulePoll(device, device.interval)

      // Best-effort — clipboard permission prompts (or their absence) must never block sign-in.
      navigator.clipboard?.writeText(device.userCode).then(
        () => {
          if (!cancelledRef.current) {
            setState((s) => (s.phase === 'waiting' ? { ...s, copied: true } : s))
          }
        },
        () => {
          // clipboard access denied/unavailable — the code is still visible to copy by hand
        },
      )
    } catch (err) {
      if (cancelledRef.current) return
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'Could not start GitHub sign-in.' })
    }
  }

  if (state.phase === 'idle') {
    return (
      <Button variant="primary" className="w-full" onClick={() => void start()}>
        Continue with GitHub
      </Button>
    )
  }

  if (state.phase === 'starting') {
    return <div className="h-9 animate-pulse rounded-md bg-panel-raised" />
  }

  if (state.phase === 'error') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-danger">{state.message}</p>
        <Button variant="primary" className="w-full" onClick={() => void start()}>
          Try again
        </Button>
      </div>
    )
  }

  const { device, copied } = state
  return (
    <div className="space-y-3 text-center">
      <p className="text-xs text-text-dim">Enter this code at GitHub to finish signing in:</p>
      <p className="select-all rounded-md border border-line bg-ink py-3 font-mono text-2xl tracking-[0.3em] text-brand">
        {device.userCode}
      </p>
      {copied ? <p className="text-xs text-text-dim">Copied to your clipboard.</p> : null}
      <a
        href={device.verificationUri}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-full items-center justify-center rounded-md border border-line bg-panel-raised px-4 py-2 text-sm font-medium text-text hover:border-text-dim"
      >
        Open {device.verificationUri.replace('https://', '')} &rarr;
      </a>
      <p className="font-mono text-xs text-text-dim">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand align-middle" />
        Waiting for approval&hellip;
      </p>
    </div>
  )
}
