# features/auth

The connect flow and route guard:

- `ConnectScreen.component.ts` — PAT + OAuth tabs. Talks to `AuthService.ConnectWithToken` and
  `IOAuthGateway.FetchOAuthClientId` (via `OAUTH_GATEWAY`).
- `OAuthDeviceFlow.component.ts` — the device-code polling state machine (start → poll on an
  interval → success/pending/slow_down/denied/expired/error). Instance fields (`timer`,
  `deadline`, `cancelled`) are cleaned up in `ngOnDestroy`. Emits `(success)` with the token.
- `AuthGuard.ts` (`CanActivateFn`) — redirects to `/connect` via `router.createUrlTree(...)` when
  `AuthService.token()` is null.

`core/gateways/IOAuthGateway.ts` + `BackendOAuthGateway.service.ts` (talks to the `api/` ASP.NET
Core backend's Auth vertical, not `api.github.com` — one of several resource-specific Gateways, all
backend-mediated now) and `src/environments/environment.ts` / `environment.prod.ts` (carry
`backendApiBaseUrl`, swapped via `angular.json`'s `fileReplacements` on a production build) live
outside this folder but exist to support it.

`/connect` is a real route in `App.routes.ts`; the other three routes (`/`, `/o/:org`,
`/r/:owner/:repo`) are each behind `AuthGuard`.
