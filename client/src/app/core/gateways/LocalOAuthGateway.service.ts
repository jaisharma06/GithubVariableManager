import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { DeviceCode, DevicePollResult, IOAuthGateway } from './IOAuthGateway';

/** Port of web/src/auth/githubOAuth.ts. */
@Injectable({ providedIn: 'root' })
export class LocalOAuthGateway implements IOAuthGateway {
  private readonly http = inject(HttpClient);

  async FetchOAuthClientId(): Promise<string | null> {
    const data = await firstValueFrom(
      this.http.get<{ clientId: string | null }>(`${environment.oauthServerUrl}/api/auth/github/client-id`),
    );
    return data.clientId;
  }

  async StartDeviceFlow(): Promise<DeviceCode> {
    let data: Partial<DeviceCode> & { error?: string };
    try {
      data = await firstValueFrom(
        this.http.post<Partial<DeviceCode> & { error?: string }>(
          `${environment.oauthServerUrl}/api/auth/github/device-code`,
          null,
        ),
      );
    } catch (err) {
      throw new Error(ExtractServerErrorMessage(err) ?? 'Could not start GitHub sign-in.');
    }

    if (!data.deviceCode || !data.userCode || !data.verificationUri) {
      throw new Error(data.error ?? 'Could not start GitHub sign-in.');
    }
    return {
      deviceCode: data.deviceCode,
      userCode: data.userCode,
      verificationUri: data.verificationUri,
      expiresIn: data.expiresIn ?? 900,
      interval: data.interval ?? 5,
    };
  }

  async PollDeviceToken(deviceCode: string): Promise<DevicePollResult> {
    let data: { accessToken?: string; error?: string; interval?: number };
    try {
      data = await firstValueFrom(
        this.http.post<{ accessToken?: string; error?: string; interval?: number }>(
          `${environment.oauthServerUrl}/api/auth/github/device-token`,
          { deviceCode },
        ),
      );
    } catch (err) {
      return { status: 'error', message: ExtractServerErrorMessage(err) ?? 'GitHub sign-in failed.' };
    }

    if (data.accessToken) return { status: 'success', token: data.accessToken };

    // GitHub reports "still waiting" and "slow down" as 200 responses with an `error` field —
    // this switch handles those the same way whether they arrived via a 2xx or non-2xx status.
    switch (data.error) {
      case 'authorization_pending':
        return { status: 'pending' };
      case 'slow_down':
        return { status: 'slow_down', interval: data.interval ?? 10 };
      case 'access_denied':
        return { status: 'denied' };
      case 'expired_token':
        return { status: 'expired' };
      default:
        return { status: 'error', message: data.error ?? 'GitHub sign-in failed.' };
    }
  }
}

function ExtractServerErrorMessage(err: unknown): string | undefined {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { error?: string } | null;
    return typeof body?.error === 'string' ? body.error : undefined;
  }
  return undefined;
}
