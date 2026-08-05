import { HttpErrorResponse, HttpResponse, type HttpHeaders, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { RateLimitService } from '../services/RateLimitService';

/**
 * Reads GitHub's rate-limit headers off every response (success or error — a 403 for being
 * rate-limited still carries them) and forwards them to RateLimitService. Direct successor to
 * the header-reading block in web/src/api/client.ts's githubFetch, pulled out of the low-level
 * HTTP call so GithubHttp stays focused on request/response shape, not this cross-cutting concern.
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
