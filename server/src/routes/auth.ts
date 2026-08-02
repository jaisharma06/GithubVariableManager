import { Router } from 'express'

const router = Router()

/**
 * github.com's OAuth endpoints (unlike api.github.com) don't send CORS headers, so the browser
 * can't call them directly — these two routes exist purely to relay device-flow requests.
 * Neither one ever touches a client secret; the device flow doesn't use one.
 *
 * This app's OAuth Client ID is baked in as a default so a fresh clone works with zero setup —
 * unlike a client secret, an OAuth client ID isn't sensitive (it's the whole point of the device
 * flow: it's safe to ship in a public client that can't protect a secret). Set
 * GITHUB_OAUTH_CLIENT_ID in server/.env to point at a different OAuth App instead.
 */
const DEFAULT_CLIENT_ID = 'Ov23linDoABzhcxwgYnp'

function getClientId(): string | null {
  return process.env.GITHUB_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID || null
}

router.post('/github/device-code', async (_req, res) => {
  const clientId = getClientId()

  if (!clientId) {
    res.status(500).json({
      error: 'OAuth is not configured on this server. Set GITHUB_OAUTH_CLIENT_ID, or connect with a personal access token instead.',
    })
    return
  }

  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'repo admin:org' }),
  })

  const data = (await response.json()) as {
    device_code?: string
    user_code?: string
    verification_uri?: string
    expires_in?: number
    interval?: number
    error?: string
    error_description?: string
  }

  if (!response.ok || !data.device_code) {
    res.status(400).json({ error: data.error_description ?? data.error ?? 'GitHub rejected the device code request.' })
    return
  }

  res.json({
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  })
})

router.post('/github/device-token', async (req, res) => {
  const { deviceCode } = req.body as { deviceCode?: string }
  const clientId = getClientId()

  if (!clientId) {
    res.status(500).json({ error: 'OAuth is not configured on this server.' })
    return
  }
  if (!deviceCode) {
    res.status(400).json({ error: 'Missing device code.' })
    return
  }

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })

  const data = (await response.json()) as {
    access_token?: string
    error?: string
    interval?: number
  }

  // GitHub reports "still waiting" and "slow down" as 200 responses with an `error` field —
  // pass those straight through so the frontend's poll loop can react (not an HTTP failure).
  res.json({
    accessToken: data.access_token,
    error: data.error,
    interval: data.interval,
  })
})

/** Hands the OAuth client id to the frontend so it can tell whether OAuth is configured. */
router.get('/github/client-id', (_req, res) => {
  res.json({ clientId: getClientId() })
})

export default router
