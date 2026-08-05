# Architecture

How GitHub Variables Manager is built. For naming/SOLID/pattern conventions, see
[`CodingStandards.md`](./CodingStandards.md). For setup and usage, see the root
[`README.md`](../README.md).

## What this app is

A single-page app that gives one unified, filterable view of GitHub Actions **variables** and
**secrets** across organization, repository, and environment scope levels, instead of GitHub's own
UI which spreads them across a different settings page per level. Users connect with their own
GitHub credentials (personal access token or OAuth device flow); nothing is stored server-side.

## Two runtime pieces

```
client/   Angular 19 + TypeScript SPA — the entire application. Talks to api.github.com directly
          from the browser (GitHub's REST API supports CORS for authenticated requests).

server/   A minimal Express app with exactly one job: relaying two OAuth device-flow calls.
          github.com's OAuth endpoints (unlike api.github.com) don't send CORS headers, so those
          two calls can't be made directly from the browser. It holds no client secret (device
          flow doesn't use one) and stores nothing between requests — no database.
```

`server/src/routes/auth.ts` exposes exactly three endpoints: `POST /api/auth/github/device-code`,
`POST /api/auth/github/device-token`, and `GET /api/auth/github/client-id`. Everything else the app
does talks to `api.github.com` directly with the user's own token.

## `client/src/app` layout

```
core/
  gateways/     Typed GitHub REST client — the only layer that knows GitHub's request/response
                shapes. One interface + implementation pair per resource:
                  GithubHttp.service.ts     low-level HTTP primitive: base URL, GitHub's required
                                             Accept/API-Version headers, GitHubApiError conversion
                  IVariablesGateway / GithubVariablesGateway.service.ts
                  ISecretsGateway / GithubSecretsGateway.service.ts   (+ public-key fetch for sealing)
                  IEnvironmentsGateway / GithubEnvironmentsGateway.service.ts  (no rename endpoint)
                  IRunnersGateway / GithubRunnersGateway.service.ts
                  IScopesGateway / GithubScopesGateway.service.ts     viewer, orgs/repos, account type
                  IOAuthGateway / LocalOAuthGateway.service.ts        talks to server/, not GitHub
                  GithubPathBuilder.ts, GithubPagination.ts           shared path/pagination helpers
                Auth-header attachment, 401 detection, and rate-limit header tracking are NOT here —
                they're ambient, handled by the two interceptors below.
  facades/      Feature-facing state layer wrapping @tanstack/angular-query-experimental.
                Components inject a Facade, never a Gateway directly. LedgerFacade,
                ItemMutationsFacade, CopyFacade, DeleteEverywhereFacade, EnvironmentsFacade,
                RunnersFacade, ScopesFacade — see core/facades/README.md for what each owns and
                the query-method-vs-field rule they all follow.
  services/     AuthService (session state + localStorage persistence + cross-tab sync),
                SecretSealingService (libsodium sealed-box encryption), RateLimitService,
                LastScopeService (sessionStorage "jump back in" shortcut)
  interceptors/ AuthInterceptor (attach the session token, sign out on 401),
                RateLimitInterceptor (read GitHub's rate-limit headers off every response)
  strategies/   Empty on purpose — see core/strategies/README.md
  Types.ts      shared domain types (LedgerItem, ScopeRef, ItemLevel, …)

features/
  auth/            ConnectScreenComponent (PAT + OAuth tabs), OAuthDeviceFlowComponent
                   (device-code polling UI), AuthGuard (route guard)
  scope-picker/    Choose an org or repo to manage
  dashboard/       Screen shell: fixed non-scrolling sidebar (scope tree, runners panel, account
                   footer), header with List/Compare toggle, hosts the delete-environment and
                   rename-environment dialogs
  ledger/          The main variables/secrets list: filters, grouped sections, locked-section
                   handling, hide-values toggle, the copy-to-other-scopes dialog
  item-editor/     Create/edit slide-over, including the "also create in other environments"
                   replicate checkboxes and the org-secret visibility picker
  compare/         Matrix view: rows = names, columns = selectable scopes, inline edit/copy per
                   cell, delete-from-every-scope with a warning — owns its own dialog state
                   internally rather than routing through the dashboard shell

shared/components/  UI primitives with no feature-specific knowledge: ButtonComponent,
                    KindBadgeComponent, ConfirmDialogComponent, AvatarComponent,
                    RateLimitIndicatorComponent
```

Every folder above has its own `README.md` with more detail — start there before changing code in
a given area.

## Data flow

1. **Auth** — `AuthService` holds `{ token, method, viewer }` as a signal, mirrored to
   `localStorage` under key `ghvm.session`. A `storage` event listener keeps multiple tabs in sync.
   `AuthInterceptor` attaches the token to every outgoing request ambiently and calls
   `AuthService.SignOut()` directly on any `401` response.
2. **The ledger** — `LedgerFacade.LedgerQuery` is the central read: for a repo scope, it fans out
   one `ListVariables`/`ListSecrets` call per level (org, repo, each environment) via
   `Promise.allSettled`, so one failing/forbidden call doesn't blank the whole screen — a 403/404
   becomes a "locked section" (shown as a plain row, not an error), anything else becomes a
   dismissable partial-error banner.
3. **Mutations** — every create/update/delete mutation in `ItemMutationsFacade` does an
   **optimistic update** against the `['ledger', …]` TanStack Query cache in `onMutate`, rolling
   back via a snapshot in `onError`. Bulk operations (`CopyFacade.CopyTo`,
   `DeleteEverywhereFacade.DeleteFrom`) are thin wrappers that run N of the existing single-item
   mutations through `Promise.allSettled` and report per-target results — they don't duplicate any
   GitHub-calling logic.
4. **Components read, never fetch** — feature components inject a Facade; none of them inject
   `HttpClient` or a Gateway directly, or build a GitHub URL themselves. This is what makes a
   future ASP.NET Core backend swap (see "Future ASP.NET Core seam" below) a
   Gateway-implementation-only change.

## Hard constraint that shapes the UI: secrets are write-only

GitHub's API can return a **variable's** value, but can **never** return a **secret's** value, at
any level — secrets are sealed client-side (via `SecretSealingService`, using the public key
GitHub publishes per scope) and GitHub never sends the plaintext back to anyone, including this
app. This is not a missing feature; it's a hard platform limitation, and the UI is honest about it
everywhere it matters:

- Secret rows always show a locked "write-only" state instead of a value.
- Renaming a secret is really *create-under-new-name, then delete-old*
  (`ItemMutationsFacade.renameSecret`), since there's no value to carry over via a real rename.
- Copying a secret to another scope (`CopyItemDialogComponent`) always requires retyping the value
  — it can't be silently copied from an existing row the way a variable can.
- Renaming an *environment* that contains secrets requires the user to explicitly acknowledge that
  those secrets will be lost (`RenameEnvironmentDialogComponent`) unless re-added manually first.

Any future backend (ASP.NET Core) must preserve this constraint — it's a GitHub platform fact, not
an implementation detail a backend can "fix". If a task seems to require reading back a secret's
value, the task's premise is wrong, not the code.

## Design patterns in use

Every pattern here is justified against a concrete problem it solves in this codebase — see
[`CodingStandards.md`](./CodingStandards.md#design-patterns--use-deliberately-not-decoratively) for
the underlying rule.

- **Facade** — one per feature area (`core/facades/*`). Keeps components presentation-only: a
  component asks a Facade for signals and calls its methods, never touches `HttpClient` or GitHub
  REST response shapes itself.
- **Gateway/Adapter** — `core/gateways/I*Gateway` interfaces + `InjectionToken`s. The seam that
  makes a future ASP.NET Core backend swap a Gateway-implementation-only change: Facades depend
  only on the interface, never the concrete class.
- **Chain of Responsibility** — `AuthInterceptor` + `RateLimitInterceptor`, pulling cross-cutting
  HTTP concerns (credential attachment, 401 detection, rate-limit tracking) out of the Gateways
  themselves.
- **Singleton via DI** (`providedIn: 'root'`) — `AuthService`, `RateLimitService`, every Gateway
  and Facade.
- **Observer** — Angular Signals / RxJS Observables throughout, for every piece of reactive state.
- **Command-style batch operations** — `CopyFacade.CopyTo`/`DeleteEverywhereFacade.DeleteFrom`,
  implemented as `Promise.allSettled` over `ItemMutationsFacade`'s existing single-item mutations,
  so a batch (copy-to-many-scopes, delete-from-every-scope) never duplicates the underlying
  create/update/delete logic and reports per-target success/failure independently.

`core/strategies/` is intentionally empty — see its own `README.md` for the reasoning (kind-based
`variable`/`secret` branching stayed shallow enough that a formal Strategy class hierarchy would
be unjustified complexity; the decision is documented there rather than the folder silently
missing).

## Future ASP.NET Core seam

`environment.ts` / `environment.prod.ts` carries an `apiBaseUrl`; `GithubHttp.service.ts` reads it
rather than hardcoding `api.github.com`, specifically so this is a config change, not a code
change. `AuthInterceptor` attaches whichever credential shape matches the active backend.

- **Today**: `apiBaseUrl = 'https://api.github.com'`; the interceptor attaches the user's own
  PAT/OAuth token as a `Bearer` header.
- **Later (if built)**: `apiBaseUrl` would point at an ASP.NET Core backend's own `/api/...`
  routes. Only the Gateway *implementations* would change (new `useClass:` registrations); every
  Facade, Component, and Interceptor above them is unaffected — they only ever depend on the
  Gateway *interfaces*.

`server/src/routes/auth.ts`'s two relay endpoints map close to line-for-line onto ASP.NET Core
minimal-API endpoints, so that portion of a future backend would be closer to a transcription than
a redesign. The bigger piece of work would be standing up the Gateway-equivalent server-side
(proxying variables/secrets/environments/runners calls) — exactly what the Gateway/Facade split
above is designed to make swappable without touching any feature code.

## History

This app was originally built in React and ported to Angular; the original implementation is kept
at [`../archive/web/`](../archive/web/) for reference, and the full port record — design
decisions, a file-by-file mapping, and every bug found along the way — is at
[`../archive/AngularMigrationPlan.md`](../archive/AngularMigrationPlan.md). Neither is required
reading for working on the app today.
