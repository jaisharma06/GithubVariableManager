# core/interceptors

Two `HttpInterceptorFn`s, registered in `App.config.ts` via
`provideHttpClient(withInterceptors([...]))`:

- `AuthInterceptor.ts` — attaches the user's own GitHub PAT/OAuth token (via `AuthService`) to
  every outgoing request — the same credential shape the ASP.NET Core backend expects, unchanged
  since it cut over — and calls `AuthService.SignOut()` **and navigates to `/connect`** on a `401`.
- `RateLimitInterceptor.ts` — reads GitHub's rate-limit headers off every response (success or
  error) and forwards them to `RateLimitService`. Kept separate from `AuthInterceptor` for SRP:
  one interceptor per cross-cutting concern. **Known limitation**: this is currently a silent
  no-op, since `api/` doesn't read or forward GitHub's rate-limit headers on its own responses —
  documented as an acknowledged gap rather than something worth silently rediscovering later;
  exposing rate-limit info through `api/` would be new backend business logic, out of scope for
  cleanup.
