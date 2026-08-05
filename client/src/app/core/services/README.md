# core/services

App-wide singleton services (`providedIn: 'root'`):

- `AuthService.ts` — session state (`{ token, method, viewer }` as a signal), localStorage-backed
  (key `ghvm.session`), cross-tab sync via a `storage` event listener, `SignOut()` called by
  `AuthInterceptor` on a `401`.
- `RateLimitService.ts` — holds the most recent GitHub rate-limit info as a signal, fed by
  `RateLimitInterceptor`.
- `SecretSealingService.ts` — libsodium sealed-box encryption against a scope's published public
  key, per GitHub's documented scheme. Used by `GithubSecretsGateway`.
- `LastScopeService.ts` — remembers the last-visited org/repo scope in `sessionStorage`, for the
  scope picker's "jump back in" shortcut.
