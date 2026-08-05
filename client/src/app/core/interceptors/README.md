# core/interceptors

Two `HttpInterceptorFn`s, registered in `App.config.ts` via
`provideHttpClient(withInterceptors([...]))`:

- `AuthInterceptor.ts` — attaches whichever credential is currently active (today: the user's own
  GitHub PAT/OAuth token, via `AuthService`; later: whatever an ASP.NET Core backend expects) to
  every outgoing request, and calls `AuthService.SignOut()` on a `401`.
- `RateLimitInterceptor.ts` — reads GitHub's rate-limit headers off every response (success or
  error) and forwards them to `RateLimitService`. Kept separate from `AuthInterceptor` for SRP:
  one interceptor per cross-cutting concern.
