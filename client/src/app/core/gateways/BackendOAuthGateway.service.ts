import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { Viewer } from '../Types';
import { AuthTokenOverrideContext } from './AuthTokenOverride';
import type { DeviceCode, DevicePollResult, IOAuthGateway } from './IOAuthGateway';

/**
 * Talks to the `api/` ASP.NET Core backend's Auth vertical (`Endpoints/AuthEndpoints.cs`) rather
 * than api.github.com directly. Injects `HttpClient` directly — these aren't
 * api.github.com calls, so they don't need GitHub's Accept/API-Version headers.
 */
@Injectable({ providedIn: 'root' })
export class BackendOAuthGateway implements IOAuthGateway {
  private readonly http = inject(HttpClient);

  async FetchOAuthClientId(): Promise<string | null> {
    const data = await firstValueFrom(
      this.http.get<{ clientId: string | null }>(`${environment.backendApiBaseUrl}/api/auth/github/client-id`),
    );
    return data.clientId;
  }

  async StartDeviceFlow(): Promise<DeviceCode> {
    let data: Partial<DeviceCode> & { error?: string };
    try {
      data = await firstValueFrom(
        this.http.post<Partial<DeviceCode> & { error?: string }>(
          `${environment.backendApiBaseUrl}/api/auth/github/device-code`,
          null,
        ),
      );
    } catch (err) {
      throw new Error(ExtractBackendErrorMessage(err) ?? 'Could not start GitHub sign-in.');
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
    let data: { status: string; token?: string; interval?: number; message?: string };
    try {
      data = await firstValueFrom(
        this.http.post<{ status: string; token?: string; interval?: number; message?: string }>(
          `${environment.backendApiBaseUrl}/api/auth/github/device-token`,
          { deviceCode },
        ),
      );
    } catch (err) {
      return { status: 'error', message: ExtractBackendErrorMessage(err) ?? 'GitHub sign-in failed.' };
    }

    // The backend's DeviceFlowService already normalizes GitHub's vocabulary
    // (authorization_pending/slow_down/access_denied/expired_token) into this discriminated
    // union's `status` values — this is a mechanical DTO→TS reshape only, zero interpretation.
    switch (data.status) {
      case 'success':
        return { status: 'success', token: data.token! };
      case 'pending':
        return { status: 'pending' };
      case 'slow_down':
        return { status: 'slow_down', interval: data.interval ?? 10 };
      case 'denied':
        return { status: 'denied' };
      case 'expired':
        return { status: 'expired' };
      default:
        return { status: 'error', message: data.message ?? 'GitHub sign-in failed.' };
    }
  }

  async GetViewer(token: string): Promise<Viewer> {
    const data = await firstValueFrom(
      this.http.get<{ login: string; avatarUrl: string }>(`${environment.backendApiBaseUrl}/api/auth/viewer`, {
        context: AuthTokenOverrideContext(token),
      }),
    );
    return { login: data.login, avatarUrl: data.avatarUrl };
  }
}

function ExtractBackendErrorMessage(err: unknown): string | undefined {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { error?: string } | null;
    return typeof body?.error === 'string' ? body.error : undefined;
  }
  return undefined;
}
