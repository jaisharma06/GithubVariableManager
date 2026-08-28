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
- `VariableClipboardService.ts` — the in-app "copy a variable, paste it anywhere" buffer. Same tier
  as `LastScopeService`/`RateLimitService` above: no Gateway dependency, never talks to `api/`.
  Holds a single `{ name, value } | null` signal (`clipboard`), variable-only by design (a secret
  has no readable value to buffer — see `docs/Architecture.md`'s "secrets are write-only" section).
  `CopyVariable(name, value)` sets the buffer and best-effort mirrors the raw value (never
  `NAME=value`) to the real OS clipboard via `navigator.clipboard.writeText`, swallowing a rejected
  write (no permission, insecure context, unsupported browser) since the in-app buffer — what
  actually powers paste — is set regardless. The buffer persists until the next `CopyVariable` call
  overwrites it; there's no auto-clear on paste or sign-out, a deliberate product decision (copying
  one value into several scopes in a row is the common case). Consumed by `LedgerRow.component.ts`
  (writes, via its "copy value" icon), `SectionHeader.component.ts` (reads, to show/enable "Paste"),
  and `DashboardShell.component.ts` (reads, in `HandlePasteToSection`, to pre-fill the create form).

(`SecretSealingService.ts` was removed in Phase 3b — the libsodium sealed-box encryption step it
did client-side moved to `api/Services/SecretSealingService.cs`; see
`core/gateways/README.md`'s `BackendSecretsGateway.service.ts` entry.)
