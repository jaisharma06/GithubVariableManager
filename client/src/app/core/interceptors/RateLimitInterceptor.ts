import { HttpErrorResponse, HttpResponse, type HttpHeaders, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { RateLimitService } from '../services/RateLimitService';

/**
 * Reads GitHub's rate-limit headers off every response (success or error — a 403 for being
 * rate-limited still carries them) and forwards them to RateLimitService. Direct successor to
 * the header-reading block in web/src/api/client.ts's githubFetch, kept as its own interceptor so
 * this cross-cutting concern stays separate from request/response shape handling.
 *
 * Known limitation since the ASP.NET Core migration: every Gateway now talks to `api/`, not
 * `api.github.com`, and `api/` doesn't currently read or forward GitHub's rate-limit headers on
 * its own responses — so this interceptor is a silent no-op today (RateLimitService.rateLimit()
 * stays null, RateLimitIndicatorComponent renders nothing). Nothing throws; this is a quietly
 * degraded feature, not a bug in this file. Fixing it means exposing GitHub's rate-limit info
 * through `api/` (new backend business logic), which is out of scope for this file — see
 * core/interceptors/README.md.
 */
// A const holding a function is PascalCase per this project's "functions are PascalCase" rule
// (docs/CodingStandards.md); the lint rule can't express that without type-aware linting, so
// this one's spelled out explicitly below.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const RateLimitInterceptor: HttpInterceptorFn = (req, next) => {
  const rateLimitService = inject(RateLimitService);

  function ReadHeaders(headers: HttpHeaders): void {
    const remaining = headers.get('x-ratelimit-remaining');
    const limit = headers.get('x-ratelimit-limit');
    const reset = headers.get('x-ratelimit-reset');
    if (remaining !== null && limit !== null) {
      rateLimitService.SetRateLimit({
        remaining: Number(remaining),
        limit: Number(limit),
        resetAt: reset ? Number(reset) * 1000 : null,
      });
    }
  }

  return next(req).pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) ReadHeaders(event.headers);
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse) ReadHeaders(err.headers);
      },
    }),
  );
};
