import { HttpClient, HttpContext, HttpContextToken, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GitHubApiError } from './GitHubApiError';

/**
 * Normally AuthInterceptor attaches the ambient session token to every request. The one call
 * that has to run *before* a session exists — AuthService.ConnectWithToken's viewer lookup, to
 * validate a token that hasn't been stored yet — uses this to override it for a single request.
 * Owned here (the HTTP primitive layer), not by the interceptor, so Gateways depend downward on
 * GithubHttp only — never sideways on `core/interceptors`.
 */
export const AUTH_TOKEN_OVERRIDE = new HttpContextToken<string | null>(() => null);

export function AuthTokenOverrideContext(token: string): HttpContext {
  return new HttpContext().set(AUTH_TOKEN_OVERRIDE, token);
}

/**
 * The single low-level primitive every Gateway uses to reach api.github.com — direct successor
 * to web/src/api/client.ts's `githubFetch`. Credential attachment and 401 detection
 * (AuthInterceptor) and rate-limit header tracking (RateLimitInterceptor) are handled ambiently
 * by HTTP interceptors rather than here — this service only owns building the full URL, GitHub's
 * required Accept/API-Version headers, and converting a failed request into a GitHubApiError
 * with the same message-extraction behavior as the original.
 */
@Injectable({ providedIn: 'root' })
export class GithubHttp {
  private readonly http = inject(HttpClient);

  async Get<T>(path: string, context?: HttpContext): Promise<T> {
    return this.Send<T>('GET', path, undefined, context);
  }

  async Post<T = void>(path: string, body?: unknown, context?: HttpContext): Promise<T> {
    return this.Send<T>('POST', path, body, context);
  }

  async Patch<T = void>(path: string, body?: unknown, context?: HttpContext): Promise<T> {
    return this.Send<T>('PATCH', path, body, context);
  }

  async Put<T = void>(path: string, body?: unknown, context?: HttpContext): Promise<T> {
    return this.Send<T>('PUT', path, body, context);
  }

  async Delete<T = void>(path: string, context?: HttpContext): Promise<T> {
    return this.Send<T>('DELETE', path, undefined, context);
  }

  private async Send<T>(method: string, path: string, body: unknown, context?: HttpContext): Promise<T> {
    try {
      return await firstValueFrom(
        this.http.request<T>(method, `${environment.apiBaseUrl}${WithCacheBust(path)}`, { body, context, headers: RequestHeaders() }),
      );
    } catch (err) {
      throw ToGitHubApiError(err);
    }
  }
}

// Built via HttpHeaders' fluent .set() rather than an object literal — GitHub's header names
// (Accept, X-GitHub-Api-Version, ...) aren't ours to rename to fit this project's camelCase
// property convention, and .set() takes them as plain string arguments, not declared property
// keys, so there's nothing for that convention to apply to in the first place.
function RequestHeaders(): HttpHeaders {
  return new HttpHeaders().set('Accept', 'application/vnd.github+json').set('X-GitHub-Api-Version', '2022-11-28');
}

// GitHub's list endpoints can send caching headers; without something to prevent it, a browser
// can serve a stale cached GET even right after a write we just made, making changes look like
// they "didn't take" until the cache entry expires. The original app prevented this via fetch's
// `cache: 'no-store'` option — a client-only instruction that never touches the wire. A
// `Cache-Control` *request header* looks like the obvious Angular HttpClient equivalent, but
// isn't safe: it's not a CORS-safelisted header, so it must be explicitly present in GitHub's
// preflight `Access-Control-Allow-Headers` response or the browser blocks the request entirely
// before it reaches GitHub — which is exactly what broke PAT sign-in after that "fix". A
// cache-busting query parameter gets the same guarantee (the URL is never identical twice, so
// there's nothing for the browser's cache to match) with zero CORS exposure, since query
// parameters aren't headers at all.
function WithCacheBust(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}`;
}

function ToGitHubApiError(err: unknown): GitHubApiError {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: string } | null;
    const message = body?.message ?? `GitHub API error (${err.status})`;
    return new GitHubApiError(message, err.status);
  }
  return new GitHubApiError(err instanceof Error ? err.message : 'Unknown error', 0);
}
