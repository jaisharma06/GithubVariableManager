import { InjectionToken } from '@angular/core';
import type { Viewer } from '../Types';

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
 * Talks to the `api/` ASP.NET Core backend's Auth vertical rather than api.github.com directly —
 * a different concern from the 5 GitHub Gateways, and, notably, the piece of this app closest to
 * what an ASP.NET Core backend would eventually look like (see docs/Architecture.md's "The
 * ASP.NET Core migration" section) — already is, as of Phase 1.
 */
export interface IOAuthGateway {
  FetchOAuthClientId(): Promise<string | null>;
  StartDeviceFlow(): Promise<DeviceCode>;
  /** One poll of the device-token endpoint — the caller owns the interval/retry loop. */
  PollDeviceToken(deviceCode: string): Promise<DevicePollResult>;
  /** Takes an explicit token, not the ambient session — see AuthService.ConnectWithToken. */
  GetViewer(token: string): Promise<Viewer>;
}

export const OAUTH_GATEWAY = new InjectionToken<IOAuthGateway>('OAUTH_GATEWAY');
