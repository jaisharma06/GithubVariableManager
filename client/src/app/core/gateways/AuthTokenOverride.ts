import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * Normally AuthInterceptor attaches the ambient session token to every request. The one call
 * that has to run *before* a session exists — AuthService.ConnectWithToken's viewer lookup, to
 * validate a token that hasn't been stored yet — uses this to override it for a single request.
 * Owned here (the HTTP primitive layer), not by the interceptor, so Gateways depend downward on
 * this token only — never sideways on `core/interceptors`.
 */
export const AUTH_TOKEN_OVERRIDE = new HttpContextToken<string | null>(() => null);

export function AuthTokenOverrideContext(token: string): HttpContext {
  return new HttpContext().set(AUTH_TOKEN_OVERRIDE, token);
}
