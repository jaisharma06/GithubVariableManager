const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8787'

export async function fetchOAuthClientId(): Promise<string | null> {
  const res = await fetch(`${SERVER_URL}/api/auth/github/client-id`)
  const data = (await res.json()) as { clientId: string | null }
  return data.clientId
}

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export async function startDeviceFlow(): Promise<DeviceCode> {
  const res = await fetch(`${SERVER_URL}/api/auth/github/device-code`, { method: 'POST' })
  const data = (await res.json()) as Partial<DeviceCode> & { error?: string }
  if (!res.ok || !data.deviceCode || !data.userCode || !data.verificationUri) {
    throw new Error(data.error ?? 'Could not start GitHub sign-in.')
  }
  return {
    deviceCode: data.deviceCode,
    userCode: data.userCode,
    verificationUri: data.verificationUri,
    expiresIn: data.expiresIn ?? 900,
    interval: data.interval ?? 5,
  }
}

export type DevicePollResult =
  | { status: 'success'; token: string }
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'error'; message: string }

/** One poll of the device-token endpoint — the caller owns the interval/retry loop. */
export async function pollDeviceToken(deviceCode: string): Promise<DevicePollResult> {
  const res = await fetch(`${SERVER_URL}/api/auth/github/device-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceCode }),
  })
  const data = (await res.json()) as { accessToken?: string; error?: string; interval?: number }

  if (!res.ok) return { status: 'error', message: data.error ?? 'GitHub sign-in failed.' }
  if (data.accessToken) return { status: 'success', token: data.accessToken }

  switch (data.error) {
    case 'authorization_pending':
      return { status: 'pending' }
    case 'slow_down':
      return { status: 'slow_down', interval: data.interval ?? 10 }
    case 'access_denied':
      return { status: 'denied' }
    case 'expired_token':
      return { status: 'expired' }
    default:
      return { status: 'error', message: data.error ?? 'GitHub sign-in failed.' }
  }
}
