# core/gateways

One narrow interface per GitHub resource, plus an `HttpClient`-backed implementation of each,
registered against an `InjectionToken` in `App.config.ts`. This is the seam that makes a future
ASP.NET Core backend swap a one-place change: swap the provider registration, not the callers —
see `docs/Architecture.md`'s "Gateway/Adapter" pattern entry for the full rationale.

## Contents

- `IVariablesGateway.ts` / `GithubVariablesGateway.service.ts`
- `ISecretsGateway.ts` / `GithubSecretsGateway.service.ts` (uses `SecretSealingService` for the
  libsodium sealed-box step)
- `IEnvironmentsGateway.ts` / `GithubEnvironmentsGateway.service.ts`
- `IRunnersGateway.ts` / `GithubRunnersGateway.service.ts`
- `IScopesGateway.ts` / `GithubScopesGateway.service.ts`
- `IOAuthGateway.ts` / `LocalOAuthGateway.service.ts` — talks to this app's own local relay server
  (`server/src/routes/auth.ts`), not `api.github.com`, so it doesn't go through
  `GithubHttp`/`AUTH_TOKEN_OVERRIDE` at all, and its base URL comes from
  `environments/environment.ts`'s `oauthServerUrl` rather than `apiBaseUrl`. It's the piece of
  this app closest to what a real ASP.NET Core backend endpoint would look like.
- `GithubHttp.service.ts` — the shared low-level HTTP primitive every GitHub gateway above calls:
  builds the full URL from `environment.apiBaseUrl`, sets GitHub's required Accept/API-Version
  headers, converts a failed request into a `GitHubApiError`. Also owns `AUTH_TOKEN_OVERRIDE`, the
  one exception to ambient credential attachment (see its own doc comment).
- `GitHubApiError.ts`, `GithubPagination.ts`, `GithubPathBuilder.ts` — small shared helpers.

Facades/Components inject the `InjectionToken`s exported from the `I*Gateway.ts` files — never a
concrete `Github*Gateway`/`LocalOAuthGateway` class directly.
