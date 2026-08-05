# Angular Migration Plan (historical record — migration complete)

> **This is an archived, historical document.** It's the plan and phase-by-phase build log for
> porting the app from React (kept at [`web/`](./web/)) to Angular — the live app is now at
> [`../client/`](../client/) (this document, and the phase table below, still call it `angular/`
> throughout, since that was its actual folder name for the entire migration described here; it
> was renamed to `client/` afterward — see the root [`README.md`](../README.md)). It's no longer
> required reading for working on the app day to day — see
> [`../docs/Architecture.md`](../docs/Architecture.md), [`../docs/CodingStandards.md`](../docs/CodingStandards.md),
> and the root [`README.md`](../README.md) for that. Kept here because it's a detailed record of
> *why* the current Angular codebase looks the way it does — file-by-file mapping from the old
> React code, design decisions and the reasoning behind them (including two that were planned and
> then deliberately not built once real code existed), and a phase-by-phase account of real bugs
> found and fixed along the way. Useful if you're ever asking "why is this structured this way"
> and the answer isn't obvious from the current code alone.

## Purpose

This is the plan for porting `web/` (React 19 + TypeScript + Vite) to Angular, with an ASP.NET
Core backend explicitly anticipated as a later phase. The two hard requirements driving every
decision below: **feature parity** (nothing in the checklist at the bottom regresses) and **a
clean seam for the future backend** (today's direct-to-`api.github.com` calls must be swappable for
calls to a future .NET backend without rewriting feature code).

This document is the plan. It does not itself port any code — see
[Migration phasing](#migration-phasing) for how the actual port is sequenced once undertaken.

## Decisions made (and why)

| Decision | Choice | Why |
|---|---|---|
| Angular version | Latest stable that supports this environment's Node version, standalone components (no `NgModule`s) — scaffolded as **19.2**, since this machine's Node 18.20.7 doesn't meet Angular 20+'s Node ≥20.19 minimum | Standalone components map cleanly onto this app's already-modular `features/*` structure without an extra module-wiring layer. Revisit the pinned major once Node is upgraded — nothing else in this plan depends on a specific Angular minor. |
| Routing | Angular Router, one `loadComponent` per feature | Parity with today's React Router routes (`/connect`, `/`, `/o/:org`, `/r/:owner/:repo`), plus free code-splitting per feature (today's app has none) |
| Styling | Tailwind CSS, `web/src/index.css`'s design tokens (`--color-*` custom properties) reused verbatim | Tailwind and CSS custom properties are framework-agnostic — zero visual risk, zero rework |
| Server-state / caching | [`@tanstack/angular-query-experimental`](https://tanstack.com/query/latest/docs/framework/angular/overview) (the package is still published under the `-experimental` suffix upstream, despite being the standard, documented way to use TanStack Query with Angular) | The official Angular port of the exact library already powering `api/hooks.ts`. Mutations, cache invalidation, and the optimistic-update-with-rollback pattern (`onMutate`/`onError`) carry over almost mechanically — lowest rewrite risk of any option considered. Hand-rolled signal-based caching was considered and rejected: it would re-implement (and risk subtly changing) logic that already works, for no gain at this app's size. |
| Where the new app lives | Sibling `angular/` folder, alongside `web/` | `web/` keeps running, untouched, for the entire port. Nothing breaks mid-migration because the old app is never modified before an explicit, approved cutover. |
| New app's package manager / workspace | Own `angular/package.json`, added to the root npm workspaces list alongside `web`/`server` once scaffolded | Matches the existing root-level workspace pattern (`package.json`'s `workspaces: ["web", "server"]`) |

## Target architecture

```
angular/
  src/app/
    core/
      gateways/           IVariablesGateway, ISecretsGateway, IEnvironmentsGateway,
                           IRunnersGateway, IScopesGateway (interfaces + InjectionTokens)
                           + GithubVariablesGatewayService etc. (implementations)
      services/            AuthService, RateLimitService, SecretSealingService
      facades/              LedgerFacade, ItemMutationsFacade, CopyFacade, DeleteEverywhereFacade,
                             EnvironmentsFacade, RunnersFacade, ScopesFacade (not in the original
                             plan's tree, but this is where most of the actual state-orchestration
                             weight ended up — see core/facades/README.md)
      strategies/           planned (IItemKindStrategy, VariableStrategy, SecretStrategy), not
                             built — see "Plan vs. what got built" below
      interceptors/         AuthInterceptor (attach credential, detect 401), RateLimitInterceptor
      Types.ts               shared domain types — direct port of api/types.ts
    features/
      scope-picker/
      dashboard/            DashboardShellComponent, ScopeSidebarComponent,
                             RunnersPanelComponent, RenameEnvironmentDialogComponent
      ledger/                LedgerComponent, LedgerRowComponent, FilterBarComponent,
                             SectionHeaderComponent, CopyItemDialogComponent
      item-editor/           ItemEditorPanelComponent
      compare/               CompareViewComponent
      auth/                  ConnectScreenComponent, OAuthDeviceFlowComponent, AuthGuard
    shared/
      components/            ButtonComponent, KindBadgeComponent, ConfirmDialogComponent,
                             AvatarComponent, RateLimitIndicatorComponent
    App.routes.ts
    App.config.ts
```

This mirrors `web/src`'s existing `api/` / `auth/` / `features/*` / `components/` / `lib/` split
almost exactly — the folder rename (`api/` → `core/gateways` + `core/services`, `lib/` → folded into
`core/services`, `components/` → `shared/components`) reflects Angular idiom, not a restructure of
the app's actual boundaries.

## React → Angular mapping

| React (today) | Angular (planned) | Notes |
|---|---|---|
| `api/client.ts` | `AuthInterceptor` (`HttpInterceptorFn`) + per-gateway `HttpClient` calls | 401 detection moves from a hand-rolled `notifyUnauthorized()` pub/sub (`lib/authEvents.ts`) into the interceptor calling `AuthService.SignOut()` directly |
| `api/variables.ts` | `IVariablesGateway` + `GithubVariablesGatewayService` | |
| `api/secrets.ts` | `ISecretsGateway` + `GithubSecretsGatewayService` | Public-key fetch + sealing stays paired with the put call, same as today |
| `api/environments.ts` | `IEnvironmentsGateway` + `GithubEnvironmentsGatewayService` | No rename endpoint in GitHub's API — same create+copy+delete approach as today's `RenameEnvironmentDialog`, ported as-is |
| `api/runners.ts` | `IRunnersGateway` + `GithubRunnersGatewayService` | |
| `api/scopes.ts` | `IScopesGateway` + `GithubScopesGatewayService` | |
| `api/paths.ts` | `GithubPathBuilder` (static helper class or plain functions) | |
| `api/hooks.ts` (`useLedger`) | `LedgerFacade` (wraps `@tanstack/angular-query-experimental`'s `injectQuery`) | Same fan-out-with-`Promise.allSettled`/locked-section logic, ported to RxJS `forkJoin` + per-call `catchError` |
| `api/hooks.ts` (`useCreateVariable` etc.) | `ItemMutationsFacade` (wraps `injectMutation`) | Optimistic update via the mutation's `onMutate`/`onError`, same as today |
| `api/hooks.ts` (`useCopyItem`, `useDeleteEverywhere`) | `CopyFacade`, `DeleteEverywhereFacade` | RxJS `forkJoin` over the single-item mutations, mirroring today's `Promise.allSettled` batching |
| `auth/AuthContext.tsx` | `AuthService` (`providedIn: 'root'`, session held as a `signal`) | localStorage persistence, `storage`-event cross-tab sync, and 401 auto-logout all move here |
| `auth/ConnectScreen.tsx` | `ConnectScreenComponent` | |
| `auth/OAuthDeviceFlow.tsx` | `OAuthDeviceFlowComponent` | Polling loop kept as a plain `setTimeout` chain (matching the original — no RxJS `interval`/`timer` needed), cleaned up via `ngOnDestroy` |
| `auth/RequireAuth.tsx` | `AuthGuard` (`CanActivateFn`) | |
| `auth/githubOAuth.ts` | `IOAuthGateway` + `LocalOAuthGateway.service.ts` (`core/gateways/`) | Talks to the local relay server (`server/`), not `api.github.com` — a 6th Gateway alongside the 5 GitHub ones |
| `lib/authEvents.ts` | Folded into `AuthService` (a `Subject`/signal it owns) | No separate pub/sub module needed — Angular DI singletons make the module-level `Set<Listener>` workaround unnecessary |
| `lib/rateLimitStore.ts` | `RateLimitService` (`providedIn: 'root'`, signal-based) | |
| `lib/crypto.ts` | `SecretSealingService` | Same libsodium sealed-box call, same GitHub-documented scheme, unchanged |
| `lib/lastScope.ts` | `LastScopeService` (sessionStorage, unchanged) | |
| `components/Button.tsx` | `ButtonComponent` | `variant`/`size` become `@Input()`s |
| `components/Badge.tsx` (`KindBadge`) | `KindBadgeComponent` | |
| `components/ConfirmDialog.tsx` | `ConfirmDialogComponent` | `description: ReactNode` becomes projected content (`<ng-content>`) so the delete-everywhere bullet list still works |
| `components/Avatar.tsx` | `AvatarComponent` | `onLoad`/`onError` image-state logic ports directly to template event bindings + a component signal |
| `components/RateLimitIndicator.tsx` | `RateLimitIndicatorComponent` | |
| `features/scope-picker/ScopePicker.tsx` | `ScopePickerComponent` | |
| `features/dashboard/Dashboard.tsx` | `DashboardShellComponent` | Owns modal state (`editorState`, `copyTarget`, `deleteTarget`, `envToDelete`, `envToRename`, `viewMode`) exactly as today, as component signals |
| `features/dashboard/ScopeSidebar.tsx` | `ScopeSidebarComponent` | Fixed, non-scrolling layout requirement carries over unchanged |
| `features/dashboard/RunnersPanel.tsx` | `RunnersPanelComponent` | 30s poll via `@tanstack/angular-query-experimental`'s `refetchInterval` |
| `features/dashboard/RenameEnvironmentDialog.tsx` | `RenameEnvironmentDialogComponent` | Same create→copy-variables→conditional-delete flow, same secret-loss opt-in checkbox |
| `features/ledger/Ledger.tsx` | `LedgerComponent` | |
| `features/ledger/LedgerRow.tsx` | `LedgerRowComponent` | |
| `features/ledger/FilterBar.tsx` | `FilterBarComponent` | |
| `features/ledger/SectionHeader.tsx` | `SectionHeaderComponent` | |
| `features/ledger/CopyItemDialog.tsx` | `CopyItemDialogComponent` | |
| `features/item-editor/ItemEditorPanel.tsx` | `ItemEditorPanelComponent` | Built with plain writable signals + manual event handlers, **not** Angular Reactive Forms as originally planned here — every other form-like component already ported (`ScopeSidebarComponent`, `RenameEnvironmentDialogComponent`) uses the same plain-signal pattern, and this form's validation (one regex check) doesn't earn Reactive Forms' complexity; `lockTarget`/`initialName`/`initialKind`/`initialLevel`/`initialEnv` become `@Input()`s exactly as today |
| `features/compare/CompareView.tsx` | `CompareViewComponent` | Column-visibility default (org/repo **unchecked**, environments checked) is a **required parity item** — carry the `deselected` default set forward exactly |
| `App.tsx` | `App.routes.ts` | Same four routes |
| `main.tsx` | `main.ts` + `App.config.ts` | `provideHttpClient(withInterceptors([authInterceptor]))`, `provideTanStackQuery(queryClient)`, `provideRouter(routes)` |

## Design patterns used, and why

Each pattern below is justified against a concrete problem already visible in the current code —
none are speculative additions.

- **Facade** — one per feature (`LedgerFacade`, `ItemMutationsFacade`, `CopyFacade`,
  `DeleteEverywhereFacade`, `AuthService` acting as a facade over auth state). Mirrors the existing
  custom-hook layer in `api/hooks.ts` 1:1. Keeps components presentation-only (SRP): a component
  asks a Facade for signals/observables and calls its methods, never touches `HttpClient` or
  GitHub REST response shapes itself.
- **Repository/Gateway (Adapter)** — `IVariablesGateway`, `ISecretsGateway`,
  `IEnvironmentsGateway`, `IRunnersGateway`, `IScopesGateway`. This is **the** seam that makes the
  future ASP.NET Core swap a one-place change: today's implementation calls `api.github.com`
  directly; tomorrow's implementation calls `/api/...` on the .NET backend instead. Facades depend
  only on the interface (via an Angular `InjectionToken`), never the concrete class — swapping the
  `provide:`/`useClass:` registration in `App.config.ts` is the entire migration for this layer.
- **Strategy — planned here, not actually adopted (see "Plan vs. what got built" below).**
- **Observer** — RxJS Observables / Angular Signals are the native version of what
  `lib/authEvents.ts` and `lib/rateLimitStore.ts` hand-roll today (a `Set` of listener callbacks +
  a notify function). Angular gives this for free through DI-managed reactive state — no custom
  pub/sub module needed.
- **Singleton via DI** (`providedIn: 'root'`) — `AuthService`, `RateLimitService`, the Gateway
  services. Same one-instance-app-wide intent as today's module-level state in
  `authEvents.ts`/`rateLimitStore.ts`, but expressed as a first-class DI concept instead of module
  scope as a side effect.
- **Chain of Responsibility** — the `AuthInterceptor` (attach credential header, detect 401, call
  `AuthService.SignOut()`) replaces the manual header-building in `api/client.ts` and its inline
  `notifyUnauthorized()` call, pulling a cross-cutting concern out of business logic (SRP). If a
  future ASP.NET Core backend needs a different credential shape (e.g. its own session cookie
  instead of a raw GitHub token), it's a second interceptor in the chain, not a rewrite of every
  Gateway.
- **Command-style batch operations** — `CopyFacade.CopyTo`/`DeleteEverywhereFacade.DeleteFrom`,
  implemented with `Promise.allSettled` (not RxJS `forkJoin` as originally planned here — see
  below), are the direct successor to `useCopyItem`/`useDeleteEverywhere`'s own
  `Promise.allSettled` batches (copy-a-value-to-many-scopes, delete-a-name-from-every-scope). Each
  batch is a list of independently-run, independently-reported operations against
  `ItemMutationsFacade`'s existing per-item mutations — no GitHub-calling logic duplicated.

### Plan vs. what got built

Two things in this section were planned before implementation started and turned out differently
once real code existed — recorded here rather than silently rewriting history, since "the plan
was right all along" would be misleading to a future reader comparing this doc to the source:

- **Strategy (`IItemKindStrategy`/`VariableStrategy`/`SecretStrategy`) was never built.** The
  `kind === 'variable' ? … : …` branching this was meant to centralize turned out to stay
  shallow — a handful of two-way ternaries in `ItemEditorPanelComponent`, `CopyItemDialogComponent`,
  and `ItemMutationsFacade`, each already small and file-local. Introducing a class hierarchy for
  that would have been exactly the kind of "pattern added because best practice, not because a
  named problem needs it" `CodingStandards.md` warns against — so it wasn't added. If a second item
  kind ever gets added (unlikely — GitHub's Actions config has had exactly two for years), and the
  branching grows past a handful of shallow ternaries, that's the trigger to revisit this decision,
  not a deadline that was missed.
- **`CopyFacade`/`DeleteEverywhereFacade` use `Promise.allSettled`, not RxJS `forkJoin` as
  originally planned.** Once `ItemMutationsFacade`'s mutations existed as `injectMutation`'s
  `.mutateAsync()` (a `Promise`-returning API, not an `Observable`-returning one), batching them
  with `Promise.allSettled` was the direct, dependency-free way to do it — reaching for `forkJoin`
  would have meant wrapping each `mutateAsync()` call back into an `Observable` for no behavioral
  gain. Same settle-independently, report-per-target semantics either way.

## SOLID mapping

- **S**RP — Gateways only do HTTP; Facades only orchestrate state; Components only render + collect
  input; Interceptors only handle cross-cutting HTTP concerns.
- **O**CP — a new GitHub resource gets a new Gateway interface + implementation, with nothing
  existing edited.
- **L**SP — every Gateway implementation (`GithubVariablesGateway`, etc.) must be fully
  substitutable behind its interface — a future ASP.NET-Core-backed implementation must satisfy the
  same contract with no surprising behavior swapped in.
- **I**SP — narrow per-resource Gateway interfaces (mirroring the already-separate
  `variables.ts`/`secrets.ts`/`environments.ts`/`runners.ts`/`scopes.ts` files today) instead of one
  `IGithubApi` interface covering everything.
- **D**IP — Facades and Components depend on Gateway *interfaces* (`InjectionToken`s), never on
  `HttpClient` or `api.github.com`-specific response shapes directly. This is what makes the future
  backend swap safe.

## Naming convention

See [`../docs/CodingStandards.md`](../docs/CodingStandards.md#naming-convention) for the full rule — summarized:
**PascalCase file and method names, camelCase variables/properties**, an explicit, intentional
deviation from Angular's default kebab-case-file style guide, enforced via `@angular-eslint` custom
rules once the workspace exists (not left as an honor system).

## State management: why `@tanstack/angular-query-experimental` over NgRx or plain signals

This app's state is almost entirely **server cache** (the ledger, environments, runners, rate
limit) plus small pieces of **local UI state** (which modal is open, filter selections) — the exact
shape TanStack Query already models well in the current React app. A full NgRx store was considered
and rejected: it would add a global-store, action/reducer/effect layer this app has no need for
(no cross-feature state machine, no undo/redo, no complex derived state beyond what a `computed`
signal handles) — that's unjustified complexity for this app's actual size (YAGNI). Hand-rolled
signal-based caching (no library) was also considered and rejected: it would re-implement
`@tanstack/angular-query-experimental`'s optimistic-update, retry, cache-invalidation, and stale-time behavior
from scratch, for no benefit, and risks subtly diverging from the exact behavior already proven in
`api/hooks.ts`.

## Future ASP.NET Core seam

`environment.ts` / `environment.prod.ts` carries an `apiBaseUrl` (`GithubHttp.service.ts` reads it
rather than hardcoding `api.github.com`, specifically so this swap is a config change, not a code
change). `AuthInterceptor` attaches whichever credential shape matches the active backend:

- **Today**: `apiBaseUrl = 'https://api.github.com'`; interceptor attaches the user's own PAT/OAuth
  token as a `Bearer` header — functionally identical to the original React app.
- **Later (target)**: `apiBaseUrl` points at the ASP.NET Core backend's own `/api/...` routes. Only
  the Gateway *implementations* change (new `useClass:` registrations); every Facade, Component,
  and Interceptor above them is unaffected — they only ever depended on the Gateway *interfaces*.

`server/src/routes/auth.ts`'s two relay endpoints (`POST /github/device-code`,
`POST /github/device-token`, plus the `GET /github/client-id` helper) map close to line-for-line
onto three ASP.NET Core minimal-API endpoints (`MapPost("/api/auth/github/device-code", …)`, etc.)
— that portion of the eventual backend is closer to a transcription than a redesign. The bigger
piece of backend work is standing up the Gateway-equivalent server-side (proxying
variables/secrets/environments/runners calls), which is exactly what the Angular-side
Gateway/Facade split is designed to make swappable without touching the frontend's feature code.

The secret-sealing scheme (`SecretSealingService`, libsodium sealed-box against GitHub's published
public key) is safe to keep client-side even after a backend exists — it's the scheme GitHub's own
documentation specifies for public clients — but could optionally move server-side later without
changing the constraint it exists to satisfy (GitHub still never returns a secret's plaintext
either way).

## Migration phasing

Each phase is independently shippable and verifiable — `web/` is not touched until Phase 10, and
only after explicit sign-off.

| Phase | Scope |
|---|---|
| 0 ✅ | Scaffold `angular/` workspace: Angular CLI project, `@angular-eslint` + naming-convention rules, Tailwind wired to the same `index.css` tokens, `@tanstack/angular-query-experimental` installed and provided. Done — see `angular/README.md` for exact status, the Angular-version-vs-Node-version note, and two unrelated npm-workspace-hoisting quirks hit and fixed along the way. `ng build`/`ng lint`/`ng test` all verified green; `web/`/`server/` re-verified unaffected. |
| 1 ✅ | Core infra: all 5 Gateway interfaces + implementations (1:1 port of `api/*.ts`), `AuthService`, `SecretSealingService`, `LastScopeService`, `AuthInterceptor` + `RateLimitInterceptor`, all wired into `App.config.ts`. Done — see `core/{gateways,services,interceptors}/README.md` for exact contents. `ng build`/`ng lint`/`ng test` all verified green after; `web/`/`server/` re-verified unaffected. |
| 2 ✅ | Shared UI primitives: `ButtonComponent`, `KindBadgeComponent`, `ConfirmDialogComponent`, `AvatarComponent`, `RateLimitIndicatorComponent`. Done, each with a real (not just smoke-test) spec — see `shared/components/README.md`. `ng build`/`ng lint`/`ng test` (17/17) all verified green after; `web/`/`server/` re-verified unaffected. |
| 3 ✅ | Auth flow: `ConnectScreenComponent`, `OAuthDeviceFlowComponent`, `AuthGuard`. Done — also added a 6th Gateway (`IOAuthGateway`, for the local relay server, distinct from the 5 GitHub ones) and `environments/environment.ts` (carries `oauthServerUrl`). `/connect` is now a real route. See `features/auth/README.md`. `ng build` (dev + prod configs), `ng lint`, `ng test` (25/25) all verified green after; `web/`/`server/` re-verified unaffected. |
| 4 ✅ | `ScopePickerComponent`. Done — see `features/scope-picker/README.md`. Uncovered and fixed a real bug in `ScopesFacade` along the way (see Phase 5 row — the fix is shared). `ng build`/`ng lint`/`ng test` all verified green after; `web/`/`server/` re-verified unaffected. |
| 5 ✅ | Dashboard shell: `DashboardShellComponent`, `ScopeSidebarComponent`, `RunnersPanelComponent`, `RenameEnvironmentDialogComponent`. Done — see `features/dashboard/README.md`. Also added the full `core/facades/` layer this phase actually needed (`LedgerFacade`, `ItemMutationsFacade`, `CopyFacade`, `EnvironmentsFacade`, `RunnersFacade`, plus `ScopesFacade`'s query methods) — see `core/facades/README.md`. Found and fixed two real bugs during testing: `ScopesFacade`'s org/repo queries were eager shared fields, firing unconfigured fetches for any consumer (converted to methods); `RenameEnvironmentDialogComponent` read a required input in a field initializer, throwing `NG0950` under `TestBed`'s `setInput()` path (moved to `ngOnInit`). Also established the `WaitFor` real-polling test helper (`core/testing/README.md`) after discovering TanStack Angular Query runs outside NgZone, making `whenStable()`/`fakeAsync` unable to observe query (but not mutation) resolution. `ng build` (dev + prod), `ng lint`, `ng test` (41/41) all verified green after; `web/`/`server/` re-verified unaffected. |
| 6 ✅ | Ledger: `LedgerComponent`, `LedgerRowComponent`, `FilterBarComponent`, `SectionHeaderComponent`. Done — see `features/ledger/README.md`. `CopyItemDialog.tsx` intentionally stayed out of this phase (it belongs with Phase 7's item editor — both are only reachable from a Ledger row's edit/copy buttons, neither of which had anywhere real to go yet). Wired into `DashboardShellComponent`'s `<main>`, replacing the Phase 5 placeholder for the list view; item delete went fully live (`ItemMutationsFacade` + `ConfirmDialogComponent` already existed), while add/edit/copy now show an honest "built in Phase 7" placeholder instead of a dead click, with their target state (`editorState`/`copyTarget`) already shaped for Phase 7 to consume directly. `ng build` (dev + prod), `ng lint`, `ng test` (65/65) all verified green after; `web/`/`server/` re-verified unaffected. |
| 7 ✅ | Item editor + copy: `ItemEditorPanelComponent`, `CopyItemDialogComponent`. Done — see `features/item-editor/README.md` and `features/ledger/README.md`. Deviated from this doc's original "Reactive Forms" plan for `ItemEditorPanelComponent` in favor of the plain-signal pattern already established by every other form in this codebase (see the mapping table row above for why). Wired into `DashboardShellComponent`, replacing the last two Phase 6 placeholders (add/edit/copy) with real dialogs — no stubs remain in the ledger-row action flow. `ng build` (dev + prod), `ng lint`, `ng test` (81/81) all verified green after; `web/`/`server/` re-verified unaffected. |
| 8 ✅ | `CompareViewComponent`. Done — see `features/compare/README.md`. Added `DeleteEverywhereFacade` (`core/facades/`), mirroring `CopyFacade`'s shape, for the row-delete-from-every-scope flow. The organization/repository-columns-unchecked-by-default parity requirement carried forward exactly. Unlike `LedgerComponent`, this component owns its own edit/copy/delete-row dialog state internally (matching the React original) rather than bubbling it through `DashboardShellComponent` — documented as a deliberate, not accidental, architectural asymmetry. Wired into `DashboardShellComponent`, replacing the Compare-mode placeholder that had existed since Phase 5/6 — no placeholders remain anywhere in the dashboard shell. `ng build` (dev + prod), `ng lint`, `ng test` (93/93) all verified green after; `web/`/`server/` re-verified unaffected. |
| 9 ✅ | Parity QA. No browser tool was available in the environment that ran this phase, so this was a **code-level audit** rather than the originally-planned literal side-by-side click-through: every React source file re-read against its Angular port, prioritizing Phases 0–3 (auth, gateways, secret sealing, rate limiting, OAuth device flow) since Phases 4–8 already got heavy test-driven scrutiny during their own builds. Found and fixed two real issues: `GithubHttp.service.ts` used a `Cache-Control: no-cache` request header where the original's `cache: 'no-store'` is a stronger guarantee (tightened to `no-store`); `web/src/auth/ConnectScreen.tsx` had stale copy ("session storage") left over from an earlier localStorage migration, predating the Angular port entirely (fixed in `web/`; the Angular port already had it right). Everything else audited — `AuthService`/interceptors, `SecretSealingService`, the full OAuth device-flow polling/timer logic cross-checked against the actual `server/` relay's status codes, `AuthGuard`, `LastScopeService`, `Avatar`, `RateLimitIndicator`, and the variables/secrets/environments/runners/scopes Gateways — came back exact parity. Both dev servers were started for manual spot-checking alongside the code audit. `ng build`/`ng lint`/`ng test` (93/93) reverified green after the fixes; `web/`/`server/` reverified unaffected. |
| 10 ✅ | Cutover. Root `package.json`'s `dev` script now runs `server/` + `angular/` (was `server/` + `web/`); `web/` stays in the repo, still fully buildable/runnable on its own (`npm run dev:web`), just no longer the default — the "keep in repo, remove from root scripts" option, chosen explicitly over moving/deleting it. Added `web/README.md` explaining why it's still there. Updated `CLAUDE.md`, root `README.md`, `docs/Architecture.md` (full rewrite — now describes the Angular app as "today", not React), and `docs/CodingStandards.md` to reflect Angular as the live app. Along the way, doing this rewrite surfaced two more stale planning claims worth fixing rather than copying forward: this doc's "Strategy" and "RxJS `forkJoin`" design-pattern claims didn't match what was actually built (see "Plan vs. what got built" above) — and the "Future ASP.NET Core seam" section's claim that `environment.ts` carries `apiBaseUrl` wasn't true yet (the GitHub base URL was a hardcoded const in `GithubHttp.service.ts`) — fixed by actually adding `apiBaseUrl` to `environment.ts`/`environment.prod.ts` and sourcing `GithubHttp` from it, making the documented seam real rather than aspirational. `ng build` (dev + prod), `ng lint`, `ng test` (93/93) all verified green after; `web/`/`server/` re-verified unaffected. |

## Feature-parity checklist

Every feature currently in the app, for the port to be checked off against feature-by-feature.
This list — not "it looks similar" — is what "nothing breaks" means for this migration.

- [x] Dual auth: personal access token, and OAuth device flow (code display, clipboard copy,
      poll/backoff/expiry handling)
- [x] Session persists in `localStorage` (not just the tab) until sign-out or GitHub rejects the
      token (401 auto-logout); multiple open tabs stay in sync
- [x] Scope picker: search organizations and repositories
- [x] Sidebar is fixed-position, full viewport height, does not scroll as a whole
- [x] Account avatar: fetches the GitHub profile photo, falls back to the first-letter initial
      while loading or on image error
- [x] Ledger: level filter (all/org/repo/environment), kind filter (all/variable/secret),
      environment filter, name search
- [x] Ledger: grouped sections per level/environment with descriptions and per-section "+ Add"
- [x] Ledger: locked sections (403/404) shown as a plain disabled row, not an error
- [x] Ledger: partial-error banner when some (not all) sections fail to load
- [x] Ledger: "Hide values" toggle masks every variable at once; secrets are always masked
- [x] Create / edit / delete a variable or secret, level- and environment-aware
- [x] Org-level secret visibility picker: all repos / private repos / hand-picked selection
- [x] Secret "rename" = create under new name + delete old (no true rename exists)
- [x] Copy an existing variable/secret's value to one or more other scopes (dialog), with the
      value editable before copying, and existing-value/overwrite hints per destination
- [x] "Also create in other environments" replicate checkboxes at creation time
- [x] Compare view: column toggles for organization/repository/each environment, **defaulting
      organization and repository to unchecked**
- [x] Compare view: kind filter, name search, per-cell inline edit and (for variables) copy
- [x] Compare view: empty cells show a one-click "add" pre-locked to that name/kind/scope
- [x] Compare view: delete a name from every scope it exists in, with a confirmation listing every
      affected scope
- [x] Rename an environment: create-new, copy every variable's value across, and either delete the
      old environment (no secrets present) or require an explicit "delete anyway" acknowledgment
      when secrets would be lost
- [x] Runners panel in the sidebar: repo-level or org-level self-hosted runners, live
      online/offline/busy status, refreshed periodically, graceful "no access" state on 403/404
- [x] Rate-limit indicator
- [x] Environment create / delete

## Verification once the port begins

- `tsc`/`ng build` clean at the end of every phase.
- Every phase's components checked against this document's parity checklist for the area it
  covers before moving to the next phase.
- Phase 9 is a dedicated side-by-side pass against the *entire* checklist, not just the
  most-recently-ported phase.
