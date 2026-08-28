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

This app finished its migration from a browser-talks-directly-to-GitHub architecture to one where
an ASP.NET Core backend owns all GitHub API calls and business/orchestration logic, and Angular is
reduced to rendering already-decided state. The migration proceeded vertical-by-vertical (one
GitHub resource at a time) behind the existing Gateway/interface seam — see "The ASP.NET Core
migration" below for the full phase-by-phase history.

```
client/   Angular 19 + TypeScript SPA — the UI. Never talks to api.github.com directly from the
          browser; every Gateway calls api/ instead, carrying the user's token as an
          Authorization: Bearer header.

api/      ASP.NET Core Web API (.NET 9) — the backend. Owns every GitHub API call (via Octokit.NET)
          and all business/orchestration logic. Stateless: the user's own GitHub token travels from
          client/ as an Authorization: Bearer header on every request and is forwarded to GitHub
          per-request — api/ never persists it (see "Token pass-through" below). Every vertical is
          live: Auth, Scopes, Ledger (Variables/Secrets/Environments), Runners, Workflows, and the
          batch Copy/Delete-everywhere operations.
```

## `client/src/app` layout

```
core/
  gateways/     Typed client for api/ — the only layer that knows its request/response shapes. One
                interface + implementation pair per resource:
                  AuthTokenOverride.ts      AUTH_TOKEN_OVERRIDE/AuthTokenOverrideContext — the one
                                             exception to ambient credential attachment, for a
                                             request that has to run before a session exists
                  IVariablesGateway / BackendVariablesGateway.service.ts  talks to api/'s Ledger vertical
                  ILedgerGateway / BackendLedgerGateway.service.ts    talks to api/'s merged ledger read
                  ISecretsGateway / BackendSecretsGateway.service.ts  talks to api/'s Ledger vertical
                  IEnvironmentsGateway / BackendEnvironmentsGateway.service.ts  talks to api/'s Ledger vertical
                  IRunnersGateway / BackendRunnersGateway.service.ts  talks to api/'s Runners vertical
                  IScopesGateway / BackendScopesGateway.service.ts    talks to api/'s Scopes vertical
                  IOAuthGateway / BackendOAuthGateway.service.ts      talks to api/'s Auth vertical
                  GithubPathBuilder.ts                                now just exports ItemId, a
                                                                       shared cache-key builder
                Auth-header attachment, 401 detection, and rate-limit header tracking are NOT here —
                they're ambient, handled by the two interceptors below.
  facades/      Feature-facing state layer wrapping @tanstack/angular-query-experimental.
                Components inject a Facade, never a Gateway directly. LedgerFacade,
                ItemMutationsFacade, CopyFacade, DeleteEverywhereFacade, EnvironmentsFacade,
                RunnersFacade, ScopesFacade — see core/facades/README.md for what each owns and
                the query-method-vs-field rule they all follow.
  services/     AuthService (session state + localStorage persistence + cross-tab sync),
                RateLimitService, LastScopeService (sessionStorage "jump back in" shortcut)
  interceptors/ AuthInterceptor (attach the session token, sign out on 401),
                RateLimitInterceptor (read GitHub's rate-limit headers off every response)
  strategies/   Empty on purpose — see core/strategies/README.md
  Types.ts      shared domain types (LedgerItem, ScopeRef, ItemLevel, …)

features/
  auth/            ConnectScreenComponent (PAT + OAuth tabs), OAuthDeviceFlowComponent
                   (device-code polling UI), AuthGuard (route guard)
  scope-picker/    Choose an org or repo to manage
  dashboard/       Screen shell: fixed non-scrolling sidebar (scope tree, runners panel, account
                   footer), header with List/Compare toggle, hosts the delete-environment,
                   rename-environment, and copy-environment-variables dialogs
  ledger/          The main variables/secrets list: filters, grouped sections, locked-section
                   handling, hide-values toggle, the copy-to-other-scopes dialog, the
                   copy-variable-to-clipboard/paste-from-clipboard affordances
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
2. **The ledger** — `LedgerFacade.LedgerQuery` is the central read: it calls `ILedgerGateway.GetLedger`
   once per scope. As of Phase 3a, the fan-out itself (one variables/secrets call per level — org,
   repo, each environment — run concurrently so one failing/forbidden call doesn't blank the whole
   screen) happens server-side in `api/Services/LedgerService.cs`; a 403/404 becomes a "locked
   section" (shown as a plain row, not an error), anything else becomes a dismissable partial-error
   banner — `client/` just renders the already-classified `items`/`partialErrors`/`lockedSections`
   the backend returns.
3. **Mutations** — every create/update/delete mutation in `ItemMutationsFacade` does an
   **optimistic update** against the `['ledger', …]` TanStack Query cache in `onMutate`, rolling
   back via a snapshot in `onError`. Bulk operations (`CopyFacade.CopyTo`,
   `DeleteEverywhereFacade.DeleteFrom`) are, as of Phase 6, thin wrappers around one backend call
   each (`POST /api/ledger/copy`/`POST /api/ledger/delete-everywhere`) — the per-target fan-out
   (`Task.WhenAll` over `ItemMutationService`'s existing single-item methods) and per-target result
   aggregation happen server-side now, not via client-side `Promise.allSettled`. Since there's no
   longer a per-target client-side mutation to hook an optimistic patch onto, these two Facades
   skip `onMutate` entirely and just invalidate `['ledger']` in `onSuccess` — the same
   collapse-to-one-call tradeoff `EnvironmentsFacade.renameEnvironment` already made in Phase 3c.
4. **Components read, never fetch** — feature components inject a Facade; none of them inject
   `HttpClient` or a Gateway directly, or build a GitHub URL themselves. This is what makes the
   ASP.NET Core backend cutover (see "The ASP.NET Core migration" below) a
   Gateway-implementation-only change per resource.

## Hard constraint that shapes the UI: secrets are write-only

GitHub's API can return a **variable's** value, but can **never** return a **secret's** value, at
any level — secrets are sealed and GitHub never sends the plaintext back to anyone, including this
app. This is not a missing feature; it's a hard platform limitation, and the UI is honest about it
everywhere it matters:

- Secret rows always show a locked "write-only" state instead of a value.
- Renaming a secret is really *create-under-new-name, then delete-old*, since there's no value to
  carry over via a real rename. As of Phase 3b this is one backend call
  (`ItemMutationService.RenameSecretAsync`) doing both steps server-side rather than two sequential
  client-side calls, and it reports whether the delete step actually succeeded — see "The ASP.NET
  Core migration" below for the full design and why a partial failure there is never a 5xx.
- Copying a secret to another scope (`CopyItemDialogComponent`) always requires retyping the value
  — it can't be silently copied from an existing row the way a variable can.
- Renaming an *environment* that contains secrets requires the user to explicitly acknowledge that
  those secrets will be lost (`RenameEnvironmentDialogComponent`) unless re-added manually first. As
  of Phase 3c this orchestration (create-new, copy every variable's value across, then conditionally
  delete-old) is one backend call (`api/Services/EnvironmentRenameService.cs`) rather than three
  sequential client-side mutations, mirroring how Phase 3b collapsed secret rename to one call — see
  "The ASP.NET Core migration" below for the full design and why a partial variable-copy failure
  always leaves the old environment in place, never deleted, regardless of the user's
  delete-anyway choice.

**Where sealing happens**: as of Phase 3b, the libsodium sealed-box encryption step moved
server-side (`api/Services/SecretSealingService.cs`, via `Sodium.Core`) — `client/` now sends a
secret's plaintext value to `api/` over the same `Authorization: Bearer`-authenticated request every
other mutation uses, transiently, never logged or persisted anywhere (`api/` has no database or
session store to persist it *in*, see "Token pass-through model" below). `api/` fetches the scope's
current public key, seals against it, and PUTs the encrypted value to GitHub in one call. The
platform fact this all exists because of is unchanged and stays true regardless of which side does
the sealing: **GitHub itself never returns a secret's value, to anyone, at any level.** The `api/`
backend must preserve this constraint as each vertical migrates — it's a GitHub platform fact, not
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
  makes the ASP.NET Core backend cutover a Gateway-implementation-only change per resource: Facades
  depend only on the interface, never the concrete class.
- **Chain of Responsibility** — `AuthInterceptor` + `RateLimitInterceptor`, pulling cross-cutting
  HTTP concerns (credential attachment, 401 detection, rate-limit tracking) out of the Gateways
  themselves. Note: `RateLimitInterceptor` is now a silent no-op, since `api/` doesn't forward
  GitHub's rate-limit headers back to `client/` — a known, deliberately out-of-scope gap (see
  "Status" below).
- **Singleton via DI** (`providedIn: 'root'`) — `AuthService`, `RateLimitService`, every Gateway
  and Facade.
- **Observer** — Angular Signals / RxJS Observables throughout, for every piece of reactive state.
- **Command-style batch operations** — `CopyFacade.CopyTo`/`DeleteEverywhereFacade.DeleteFrom`. As
  of Phase 6, each is one backend call (`ILedgerGateway.Copy`/`DeleteEverywhere`), fanning out
  server-side via `Task.WhenAll` over `ItemMutationService`'s existing single-item methods
  (`Services/CopyService.cs`/`Services/DeleteEverywhereService.cs`), so a batch
  (copy-to-many-scopes, delete-from-every-scope) never duplicates the underlying
  create/update/delete logic and reports per-target success/failure independently.
  `Services/EnvironmentVariableCopyService.cs` (a post-migration addition — see "Post-migration
  feature additions" below) is a **sibling** to `CopyService`, not an extension of it, even though
  both live under the same batch-operations umbrella: `CopyService`'s shape is one item -> N
  targets with always-overwrite semantics (`POST /api/ledger/copy`), while
  `EnvironmentVariableCopyService`'s shape is N variables -> one target with skip-if-exists
  semantics and a per-item value transform (`POST /api/ledger/environments/copy-variables`) — a
  different enough problem that folding it into `CopyService` would have meant branching that
  service's single-target/always-overwrite logic around a second, incompatible shape rather than
  reusing it cleanly.

`core/strategies/` is intentionally empty — see its own `README.md` for the reasoning (kind-based
`variable`/`secret` branching stayed shallow enough that a formal Strategy class hierarchy would
be unjustified complexity; the decision is documented there rather than the folder silently
missing).

## The ASP.NET Core migration

`environment.ts` / `environment.prod.ts` carries `backendApiBaseUrl`, pointing at the `api/`
backend every Gateway now talks to; `AuthInterceptor` attaches the session token to every outgoing
request. Migration happened one GitHub resource at a time: a new `Backend{Resource}Gateway.service.ts`
implements the *existing* `I{Resource}Gateway` interface against `backendApiBaseUrl`, gets verified
side-by-side with the legacy Gateway, then `useClass` is swapped in `App.config.ts` for that
resource only — every Facade/Component above the Gateway is unaffected, since they only ever depend
on the Gateway interface. This is the Gateway/Adapter pattern (see "Design patterns in use" above)
doing exactly the job it was built for.

**Token pass-through model (stateless, no server-side database — even in `api/`)**: `client/`
keeps holding the user's PAT/OAuth token exactly as it does today (`AuthService`, `localStorage`
under `ghvm.session`). Every request to `api/` carries it as an `Authorization: Bearer` header;
`api/`'s `Auth/IBearerTokenAccessor` (see `api/README.md`) extracts it per-request, and
`GitHub/GitHubClientFactory` attaches that same token to the outbound Octokit call for that same
request (`GET /api/auth/viewer` is the first endpoint to do this; later phases' endpoints reuse the
same factory). `api/` never stores the token anywhere — no session, no database, no on-disk cache —
satisfying this project's "no server-side database, ever" rule even though `api/` now owns business
logic the old seam never anticipated.

**Centralized permission-error classification**: GitHub 403/404 responses (no access to a given
org/repo/environment scope) used to be classified independently in four different places in
Angular (`LedgerSupport.RunLedgerJobs`, `GithubEnvironmentsGateway`, `RunnersPanel.component.ts`,
`WorkflowsFacade`/`WorkflowsView`). `api/`'s `Auth/PermissionErrorClassifier` (plus its
exception-handler shape, `Auth/PermissionErrorExceptionHandler`) is the one place this now happens,
returning a structured `{ locked, status, message }` shape every backend endpoint will use
uniformly as verticals migrate — Angular stops interpreting HTTP status codes itself once a
resource's Gateway is cut over.

**Status**: Phase 1 (the Auth vertical) is complete — `api/`'s `Endpoints/AuthEndpoints.cs` serves
the OAuth device-flow relay (`POST /api/auth/github/device-code`, `POST
/api/auth/github/device-token`, `GET /api/auth/github/client-id`) and the viewer lookup used by
both sign-in methods (`GET /api/auth/viewer`), and `client/`'s `IOAuthGateway` now points at
`backendApiBaseUrl` via `BackendOAuthGateway.service.ts`. `server/` (the old Express relay) has been
deleted — it's no longer part of this repo.

Phase 2 (the Scopes vertical) is also complete — `api/`'s `Endpoints/ScopesEndpoints.cs` serves
`GET /api/scopes/orgs` (the caller's orgs), `GET /api/scopes/repos` (the caller's repos), `GET
/api/scopes/orgs/{org}/repos` (an org's repos, fully paginated), and `GET
/api/scopes/accounts/{login}/type` (User vs. Organization), and `client/`'s `IScopesGateway` now
points at `backendApiBaseUrl` via `BackendScopesGateway.service.ts`. The pre-migration pagination
behavior was preserved exactly rather than "fixed": `ListMyOrgs`/`ListMyRepos` stay capped at a
single 100-item page, while `ListOrgRepos` fully paginates.

Phase 3a (the Ledger vertical's read + Variables CRUD, the first slice of the original Phase 3
split into three sub-phases given its size) is also complete — `api/`'s
`Endpoints/LedgerEndpoints.cs` serves `GET /api/ledger` (the merged variables + secrets +
environment-fan-out read, with 403/404 responses classified as locked sections and everything else
as partial errors, matching Angular's old `LedgerFacade`/`LedgerSupport.RunLedgerJobs` behavior
exactly but server-side now) and Variables CRUD (`POST`/`PUT`/`PATCH`/`DELETE
/api/ledger/variables` — create, upsert-by-name, rename+update, delete), and `client/`'s
`IVariablesGateway` now points at `backendApiBaseUrl` via `BackendVariablesGateway.service.ts`,
with a new `ILedgerGateway`/`BackendLedgerGateway.service.ts` pair replacing `LedgerFacade`'s old
internal fan-out composition. Since Octokit.NET has no typed client for Actions
Variables/Secrets/Environments, this phase introduced `api/`'s `GitHub/ActionsRestClient.cs` — a
low-level REST wrapper over Octokit's generic `Connection` methods — as the shared entry point both
`LedgerService` (reads) and `ItemMutationService` (writes) go through; see `api/README.md` for the
full detail, including the deliberate mutable-class exception `RawActionsModels.cs` takes to this
project's `sealed record` convention.

Phase 3b (Secrets CRUD, the second slice of the original Phase 3 split) is also complete —
`api/`'s `Endpoints/LedgerEndpoints.cs` adds `PUT`/`PATCH`/`DELETE /api/ledger/secrets`, and
`client/`'s `ISecretsGateway` now points at `backendApiBaseUrl` via
`BackendSecretsGateway.service.ts` (replacing `GithubSecretsGateway.service.ts` entirely), sending
plaintext directly rather than sealing client-side. The libsodium sealed-box encryption step moved
into `api/Services/SecretSealingService.cs` (via `Sodium.Core`, verified round-tripping correctly
against real keypairs with real cryptography, not mocked), replacing
`client/src/app/core/services/SecretSealingService.ts` (deleted) and its `libsodium-wrappers`
dependency entirely. `PUT /api/ledger/secrets` is a single upsert-only endpoint — unlike variables,
GitHub's own secrets PUT is already upsert-only, so there's no separate create-endpoint split.
`PATCH /api/ledger/secrets` (rename) is the one endpoint on this whole backend that deliberately
never surfaces a failure as a 5xx: `ItemMutationService.RenameSecretAsync` does put-new-name then
delete-old-name server-side, and if the delete step fails after the put already succeeded, GitHub
genuinely now has both entries — there's no GitHub API making the two steps transactional, and no
compensating action is actually safer. The endpoint reports this via `200 OK` with
`RenameSecretResponse { DeleteSucceeded: false, DeleteError: "<GitHub's message>" }` instead, so
`client/` can't wrongly roll back to believing nothing changed; `ItemMutationsFacade.renameSecret`'s
`onSuccess` handler invalidates the `['ledger']` query and surfaces the warning in that case
(`ItemEditorPanelComponent` reuses its existing `replicateFailures` warning-banner UI shape for
this, rather than inventing new UI for a second kind of partial-failure outcome). This is a real
rollback-safety improvement over the pre-migration behavior (two independent, non-atomic client-side
calls with no reporting of a partial failure at all).

Phase 3c (Environments CRUD/rename orchestration, the third and final slice of the original Phase
3 split) is also complete — `api/`'s `Endpoints/LedgerEndpoints.cs` adds `GET`/`POST`/`DELETE
/api/ledger/environments` (list, create, delete) and `POST /api/ledger/environments/rename`, and
`client/`'s `IEnvironmentsGateway` now points at `backendApiBaseUrl` via
`BackendEnvironmentsGateway.service.ts` (replacing `GithubEnvironmentsGateway.service.ts`
entirely). GitHub has no rename API for environments, so `POST /api/ledger/environments/rename`
does what used to be three sequential client-side mutations (create the new environment, copy every
environment-level variable's value across, conditionally delete the old one) in one backend call
(`api/Services/EnvironmentRenameService.cs`), following the exact outcome-reporting philosophy Phase
3b established for secret rename: new-name validation failures (empty/bad pattern/same-as-old/
already-exists) are a genuine 400 since nothing touched GitHub except a read; environment creation
is the one step allowed to propagate an `Octokit.ApiException` uncaught (the point of no return);
every step after that is caught locally and reported in `RenameEnvironmentResponse` rather than ever
5xx-ing, since GitHub already has new real state a 5xx would misrepresent. The one safety rule this
preserves exactly from the pre-migration client-side version: a partial variable-copy failure always
leaves the old environment in place, never deleted, regardless of whether the user checked "delete
anyway" — the old environment is the only remaining source of truth for whatever didn't copy.
`RenameEnvironmentDialogComponent` shrank accordingly: it collapsed its three-phase
`step: 'idle'|'creating'|'copying'|'deleting'` signal and matching three-phase button label down to
a single `submitting`/"Renaming…" state, since there's now only one request to track.

**This closes out Phase 3 (the Ledger vertical) in its entirety** — all three sub-phases (3a
Variables, 3b Secrets, 3c Environments) are done, and `EnvironmentsFacade`/`EnvironmentsService`
(kept, not replaced, since five UI consumers genuinely need to know what environments exist even
when one has zero variables/secrets — invisible in the merged ledger response) now sit alongside
`ILedgerGateway`'s merged read as the Ledger vertical's complete backend-first shape.

Phase 4 (the Runners vertical) is also complete — `api/`'s `Endpoints/RunnersEndpoints.cs` serves
`GET /api/runners` (an optional `repo` query param covers both scopes: org-only when omitted, repo
when present), and `client/`'s `IRunnersGateway` now points at `backendApiBaseUrl` via
`BackendRunnersGateway.service.ts` (replacing `GithubRunnersGateway.service.ts` entirely). Unlike
the Ledger vertical, Octokit.NET does have a real typed client for self-hosted runners
(`Actions.SelfHostedRunners`, confirmed via reflection against the installed Octokit 14.0.0
assembly) — so `Services/RunnersService.cs` follows `ScopesService`'s shape (direct typed Octokit
calls) rather than `ActionsRestClient`'s low-level REST-wrapper shape. The org-vs-repo branching
that used to live in Angular's `RunnersFacade` (calling either `ListRepoRunners`/`ListOrgRunners`)
moved server-side, collapsing `IRunnersGateway` to one method (`ListRunners(org, repo?)`). This
phase also retires `RunnersPanel.component.ts`'s own status-based permission classification — the
fourth and final of the four originally-duplicated classification sites named above
(`LedgerSupport.RunLedgerJobs` and `GithubEnvironmentsGateway` were retired in Phase 3;
`WorkflowsFacade`/`WorkflowsView.component.ts` correctly remain untouched, since Workflows hasn't
migrated yet). Since a raw `HttpErrorResponse` would otherwise reach `RunnersFacade`'s query
uncaught (every Backend gateway injects `HttpClient` directly, not `GithubHttp`), and
`RunnersPanel.component.ts`'s `noAccess` computed needs a real `GitHubApiError` to check,
`GitHubApiError` gained an optional third constructor param (`locked?: boolean`, defaulting to the
`status === 403 || status === 404` check every prior call site already computed inline, so
`WorkflowsFacade`/`WorkflowsView.component.ts`'s own still-untouched `err.status === 403` checks are
provably unaffected). `BackendRunnersGateway.service.ts` reads `locked` straight off the backend's
parsed `{ locked, status, message }` response body instead of recomputing it from `status`, so
`noAccess` now reflects the backend's actual classification (`err.locked`) rather than a
client-recomputed one.

Phase 5 (the Workflows vertical) is also complete — `api/`'s `Endpoints/WorkflowsEndpoints.cs`
serves `GET /api/workflows` (a repo's Actions workflows), `GET /api/workflows/runs` (a workflow's
runs, single page), `DELETE /api/workflows/runs` (single-run delete), and the chunked bulk-delete's
start+poll pair (`POST /api/workflows/runs/cleanup` returns `202` with a job id; `GET
/api/workflows/runs/cleanup/{jobId}` returns progress, `404` once the id is unknown), and `client/`'s
`IWorkflowsGateway` now points at `backendApiBaseUrl` via `BackendWorkflowsGateway.service.ts`
(replacing `GithubWorkflowsGateway.service.ts` entirely). Octokit.NET does have real typed clients
for Workflows and Workflow Runs (`Actions.Workflows`/`Actions.Workflows.Runs`, confirmed via
reflection, same as Runners) — `Services/WorkflowsService.cs` follows `RunnersService`'s
typed-client shape for reads and the single-run delete. The bulk-delete's chunking (5 runs at a
time, sequential chunks, `Task.WhenAll` within a chunk) moved into a new
`Services/WorkflowRunCleanupService.cs` — the one Service in this backend registered `AddSingleton`
rather than `AddScoped`, since progress has to survive between the separate "start" and "poll" HTTP
requests, tracked in an in-memory `ConcurrentDictionary<Guid, JobState>` rather than any database
(see `api/README.md` for the full design, including the two caveats it's explicit about: the bearer
token is held in memory for one background job's duration, and in-memory state is lost on a backend
restart). This retires `WorkflowsFacade`/`WorkflowsView.component.ts`'s own `err.status === 403`
checks in favor of `err.locked` — the same `GitHubApiError.locked`-reading pattern Phase 4
established for Runners — closing out the last of the four originally-duplicated
permission-classification sites.

**This closes out every individual-resource vertical.** Every `Github*Gateway.service.ts` that
used to call `api.github.com` directly has been replaced by a `Backend*Gateway.service.ts` calling
`api/` instead.

Phase 6 (the batch operations) is also complete — `api/`'s `Endpoints/LedgerEndpoints.cs` gains two
routes on the existing Ledger route group, `POST /api/ledger/copy` and `POST
/api/ledger/delete-everywhere`, one endpoint per operation with internal `kind` branching
(`Services/CopyService.cs`/`Services/DeleteEverywhereService.cs`) rather than separate per-kind
endpoints — splitting by kind would just push the kind-decision back into Angular. Both Services
fan a caller-supplied target list out with `Task.WhenAll` over `ItemMutationService`'s existing
single-item methods, so neither duplicates the create/update/delete logic Phase 3 already built.
This also let `PUT /api/ledger/variables` (upsert-by-name) retire as an externally-exposed route —
it existed only for the old client-side `CopyFacade.CopyTo`'s variable branch, which now calls
`POST /api/ledger/copy` instead; `ItemMutationService.UpsertVariableAsync` itself is kept, since
`EnvironmentRenameService` and `CopyService` both still call it in-process. On `client/`'s side,
`CopyFacade`/`DeleteEverywhereFacade` shrank to a thin wrapper each around one `ILedgerGateway`
call (`ILedgerGateway` grew to cover `Copy`/`DeleteEverywhere` alongside its merged read, the same
precedent `IWorkflowsGateway` already set in Phase 5), dropping their `ItemMutationsFacade`
dependency and its now-orphaned `upsertVariable` mutation entirely. The one interesting design
point: optimistic updates are deliberately dropped for these two Facades, not replaced with a
multi-item optimistic patch — the same tradeoff `EnvironmentsFacade.renameEnvironment` already made
in Phase 3c when its 3-step client sequence collapsed to one backend call. Both mutations skip
`onMutate` and instead `onSuccess`-invalidate the `['ledger']` query, accepting a brief refetch
flicker as an honest, documented tradeoff rather than hand-rolling a risky multi-target optimistic
patch.

**This closes out the migration's per-resource and batch work in its entirety, project-wide.**

Phase 7 (cleanup) is also complete — the dead client-side code left behind once every Gateway
pointed at `api/` has been removed: `GithubHttp.service.ts` split into the small piece still
needed (`AuthTokenOverride.ts`, `AUTH_TOKEN_OVERRIDE`/`AuthTokenOverrideContext`) with the rest
deleted, `GithubPagination.ts` was deleted outright (its pagination loop lives only in
`api/`'s `ActionsRestClient` now), `GithubPathBuilder.ts` was trimmed down to just `ItemId` (its
`VariablesPath`/`SecretsPath` URL-building functions were dead once every Gateway stopped building
GitHub URLs itself), and `apiBaseUrl` was removed from both `environment.ts` and
`environment.prod.ts` since nothing points at `api.github.com` from the browser anymore. This
closes out the ASP.NET Core migration project-wide.

One acknowledged gap this phase does not close: a real-GitHub manual smoke test (sign in, browse a
scope, create/edit/delete a variable and a secret, copy across scopes, rename an environment, view
runners, bulk-delete workflow runs) has never been performed in any phase of this migration — no
live GitHub credentials were available in this environment. Automated build/lint/test against
fakes/mocks was the practical verification ceiling throughout, and that remains a documented,
honest limitation rather than a failure to record.

## Post-migration feature additions

The ASP.NET Core migration above is closed, phase-numbered work; new features landing in `api/`
after it don't get a new phase number — they're additions built on top of the now-complete
backend-owns-all-logic shape, not another step of moving logic *out of* `client/`. Documented here
rather than silently left out of this file's narrative:

- **Ledger export to Excel** — `GET /api/ledger/export` (`Endpoints/LedgerEndpoints.cs`) renders the
  same merged read `GET /api/ledger` already computes (`Services/LedgerService.GetLedgerAsync`) as a
  downloadable `.xlsx` workbook, one worksheet per accessible level (organization/repository/each
  environment), via a new `Services/LedgerExportService.cs` (`ClosedXML`) — see `api/README.md`'s
  `Services/` entry for the full rendering design (secret rows carry an explicit write-only marker
  rather than a value or a blank, matching "Hard constraint that shapes the UI" above; a `Notes`
  sheet carries partial-error/locked-section detail a static file has no banner UI to show
  otherwise). This is new business logic in `api/` — deciding how to group/label/mark ledger data
  for export — not a rendering concern, so it correctly lives in a Service rather than being
  composed client-side from the existing `GET /api/ledger` response; `client/`'s
  `DashboardShellComponent` only triggers the download and never reshapes the file's contents
  itself. `LedgerFacade.ExportLedger`/`ILedgerGateway.ExportLedger` follow this Facade's/Gateway's
  existing shape exactly, so this required no new pattern at the `client/` layer — it's additive to
  an already-complete vertical, not a new one.

- **Cross-repo/cross-org copy** — `CopyItemDialogComponent` (`features/ledger/`) can now add a copy
  destination outside the org/repo currently open, via a new picker-only widget,
  `CrossRepoTargetPickerComponent`. This is a pure `client/`-side composition, not a new backend
  capability: `CopyFacade.CopyTo`/`ILedgerGateway.Copy`/`Services/CopyService.cs` are all unchanged
  — the new component only assembles targets from existing read Facades already used elsewhere
  (`ScopesFacade.MyOrgsQuery`/`MyReposQuery`/`OrgReposQuery`, `EnvironmentsFacade.EnvironmentsQuery`,
  `LedgerFacade.LedgerQuery` scoped to the picked destination for an accurate overwrite/matches hint)
  and hands the result to `CopyItemDialogComponent`'s existing submit path. The one new piece of
  actual logic is client-side validation, not orchestration: `CopyFacade.CopyTo`'s `options`
  (secret visibility/selected-repo list) is one value for the whole batch, so
  `CopyItemDialogComponent.HandleSubmit` blocks a submit that would need `'selected'`-visibility for
  organization-level secrets in two different destination orgs at once. See
  `features/ledger/README.md` for the full design, including the deliberate choice to duplicate the
  org-secret-visibility picker rather than extract it from `ItemEditorPanelComponent`.

- **In-app variable clipboard: copy a variable, paste it anywhere** — a `client/`-only feature,
  variables only (never secrets, since a secret has no readable value to put in a buffer in the
  first place — see "Hard constraint that shapes the UI" above). `core/services/
  VariableClipboardService.ts` is a new `providedIn: 'root'` singleton, the same tier as
  `LastScopeService`/`RateLimitService`: a signal-backed `{ name, value } | null` buffer with one
  method, `CopyVariable(name, value)`, which sets the buffer and best-effort mirrors the raw value
  (never `NAME=value`) to the real OS clipboard via `navigator.clipboard.writeText` (a rejected
  write — no permission, insecure context — is swallowed; the in-app buffer is what actually powers
  paste, and is set either way). The buffer persists until the next `CopyVariable` call overwrites
  it — no auto-clear on paste or sign-out, a deliberate product decision, since copying one value
  into several scopes in a row is the common case. `LedgerRowComponent` gained a "copy value" icon
  action (variable rows only), distinct from the pre-existing "copy to other scopes" icon that opens
  `CopyItemDialogComponent` — the two are different mechanics entirely (buffer-then-paste-later vs.
  push-now-to-N-targets-at-once), not two names for the same feature.
  `SectionHeaderComponent` gained a "Paste" affordance, shown only when the buffer is non-empty
  (`hasClipboard`), emitting `pasteVariable`; `LedgerComponent` forwards this per-section as
  `pasteToSection: { level, env? }`. `DashboardShellComponent.HandlePasteToSection` opens
  `ItemEditorPanelComponent` in its existing create flow, pre-filled from the buffer — `EditorState`'s
  `'create'` variant gained optional `name`/`value` fields, populated only by a paste (the plain
  "+ Add" flow never sets them). `ItemEditorPanelComponent` gained an `initialValue` input that seeds
  the create form's value field, and shows a "FROM CLIPBOARD" badge (reusing `KindBadgeComponent`'s
  visual recipe — same `inline-flex`/`rounded`/`px-1.5 py-0.5`/`font-mono text-[10px]` classes,
  not the component itself) when opened via paste, so the user can tell a pre-filled form apart from
  a blank one. **No backend involvement at all** — pasting still goes through the existing
  create-variable endpoint (`POST /api/ledger/variables`) for the user to review/edit/confirm before
  anything is actually created; the clipboard buffer only pre-fills a form, it never creates
  anything by itself.

- **Copy all variables from one environment to another** — unlike the clipboard feature above, this
  *is* new backend orchestration, not a `client/`-only convenience: `api/Services/
  EnvironmentVariableCopyService.cs` (see "Design patterns in use" above for why it's a sibling to
  `CopyService`, not an extension) lists the source environment's variables, skips any name that
  already exists at the destination (reported as `skipped`, not an error — the batch continues), and
  creates the rest with a case-sensitive, ordinal substring replace of the source environment's name
  with the destination's inside each value (no word-boundary/token-aware smarts, by explicit product
  decision). Source and destination can be cross-repo/cross-org — nothing in `GitHub/
  ActionsRestClient.cs` is repo-bound — but both environments must already exist; there's no inline
  environment creation as part of this flow. A failed source listing is a soft, reported failure
  (`CopyEnvironmentVariablesResponse.ListSourceError`, still `200 OK`), the same outcome-reporting
  precedent `EnvironmentRenameService` established for its own `ListVariablesError`. New endpoint:
  `POST /api/ledger/environments/copy-variables`, on the existing Ledger route group. On `client/`:
  a new `features/dashboard/CopyEnvironmentDialog.component.ts` (destination org/repo/environment
  picker, deliberately its own lightweight picker rather than a reuse of
  `CrossRepoTargetPickerComponent`, which is hard-coupled to a single `LedgerItem` and
  secret-visibility fields this variables-only, one-destination feature doesn't need), wired via a
  new `copyEnvironment` output on `ScopeSidebarComponent` (next to the existing rename/delete
  environment actions) and an `envToCopy` signal on `DashboardShellComponent` mirroring
  `envToRename`/`RenameEnvironmentDialogComponent`'s existing open/close pattern. New Gateway method
  `ILedgerGateway.CopyEnvironmentVariables(source, dest)`, new Facade mutation
  `EnvironmentsFacade.copyEnvironmentVariables` — deliberately no optimistic `onMutate`, the same
  reasoning `renameEnvironment` already established (hand-faking N variables appearing at an
  arbitrary, possibly cross-repo/cross-org destination is high-risk for low payoff); `onSuccess`
  invalidates `['ledger']` broadly. The outcome UI shows **three** buckets — copied/skipped/failed
  (plus a possible fourth, the soft `listSourceError`) — the first dialog in this app to show more
  than two outcome buckets at once, reusing the existing `border-danger/30 bg-danger-dim`
  failure-banner language for the failures/list-error buckets and a `border-ok/30`/`text-ok`
  success treatment for the copied bucket, with a neutral `bg-panel-raised` card for the skipped
  bucket (substituting where no `ok-dim` token exists in this app's palette).

## History

This app was originally built in React and ported to Angular; the original implementation is kept
at [`../archive/web/`](../archive/web/) for reference, and the full port record — design
decisions, a file-by-file mapping, and every bug found along the way — is at
[`../archive/AngularMigrationPlan.md`](../archive/AngularMigrationPlan.md). Neither is required
reading for working on the app today.
