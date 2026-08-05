import { InjectionToken } from '@angular/core';

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DevicePollResult =
  | { status: 'success'; token: string }
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'error'; message: string };

/**
 * Talks to this app's own local relay server (server/src/routes/auth.ts) rather than
 * api.github.com — a different concern from the 5 GitHub Gateways, and, notably, the piece of
 * this app closest to what an ASP.NET Core backend would eventually look like (see
 * docs/Architecture.md's "Future ASP.NET Core seam" section).
 */
export interface IOAuthGateway {
  FetchOAuthClientId(): Promise<string | null>;
  StartDeviceFlow(): Promise<DeviceCode>;
  /** One poll of the device-token endpoint — the caller owns the interval/retry loop. */
  PollDeviceToken(deviceCode: string): Promise<DevicePollResult>;
}

export const OAUTH_GATEWAY = new InjectionToken<IOAuthGateway>('OAUTH_GATEWAY');
