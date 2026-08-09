import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AUTH_TOKEN_OVERRIDE } from '../gateways/AuthTokenOverride';
import { AuthService } from '../services/AuthService';

/**
 * Every Gateway call is authenticated ambiently — this interceptor attaches whichever credential
 * is currently active (today: the user's own GitHub PAT/OAuth token; later: whatever the ASP.NET
 * Core backend expects) rather than every Gateway method taking a `token` parameter, the way
 * web/src/api/*.ts's functions do today. See AuthTokenOverride.ts's AUTH_TOKEN_OVERRIDE for the
 * one exception (the pre-session viewer lookup during connect).
 */
// A const holding a function is PascalCase per this project's "functions are PascalCase" rule
// (docs/CodingStandards.md); the lint rule can't express that without type-aware linting, so
// this one's spelled out explicitly below.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const AuthInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = req.context.get(AUTH_TOKEN_OVERRIDE) ?? authService.token();

  // .set() takes the header name as a plain string argument, not a declared property key, so
  // "Authorization" isn't subject to this project's camelCase property-naming convention — it's
  // not ours to rename, it's the HTTP spec's.
  const authedReq = token ? req.clone({ headers: req.headers.set('Authorization', `Bearer ${token}`) }) : req;

  return next(authedReq).pipe(
    catchError((err: unknown) => {
      // The stored token was revoked/expired server-side — clear the session and navigate back to
      // /connect ourselves instead of leaving the user staring at a wall of failed requests.
      // Direct successor to web/src/api/client.ts calling notifyUnauthorized() on a 401.
      if (err instanceof HttpErrorResponse && err.status === 401) {
        authService.SignOut();
        void router.navigateByUrl('/connect');
      }
      return throwError(() => err);
    }),
  );
};
