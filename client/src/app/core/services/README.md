# core/services

App-wide singleton services (`providedIn: 'root'`):

- `AuthService.ts` — session state (`{ token, method, viewer }` as a signal), localStorage-backed
  (key `ghvm.session`), cross-tab sync via a `storage` event listener, `SignOut()` called by
  `AuthInterceptor` on a `401`. `SignOut()` clears session state only; navigating to `/connect`
  is each caller's responsibility.
- `RateLimitService.ts` — holds the most recent GitHub rate-limit info as a signal, fed by
  `RateLimitInterceptor`.
- `LastScopeService.ts` — remembers the last-visited org/repo scope in `sessionStorage`, for the
  scope picker's "jump back in" shortcut.

(`SecretSealingService.ts` was removed in Phase 3b — the libsodium sealed-box encryption step it
did client-side moved to `api/Services/SecretSealingService.cs`; see
`core/gateways/README.md`'s `BackendSecretsGateway.service.ts` entry.)
