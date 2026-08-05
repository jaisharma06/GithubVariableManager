# core/facades

Facades wrap `@tanstack/angular-query-experimental` and present each feature with plain
signals/methods instead of raw query/mutation objects. Components inject a Facade, never a Gateway
directly (see `core/gateways/README.md` for the Gateway layer these sit on top of).

## Files

- **`ScopesFacade.ts`** — `MyOrgsQuery()`, `MyReposQuery()`, `OrgReposQuery(org, enabled)`,
  `IsOrgAccountQuery(login)`. **All four are methods, not shared fields.** This facade is a
  `providedIn: 'root'` singleton; a shared field (`readonly myOrgsQuery = injectQuery(...)`) would
  start fetching the moment *any* consumer injects `ScopesFacade` for *any* reason — e.g.
  `DashboardShellComponent` only wants `IsOrgAccountQuery`, but would eagerly trigger unconfigured
  org/repo list fetches too if those were fields. This was a real bug found while writing
  `DashboardShellComponent`'s tests (console errors: `Query data cannot be undefined` for the
  `["orgs", token]`/`["repos", token]` keys) — `ScopePickerComponent` is the only consumer that
  should ever trigger the org/repo list fetches, and the method pattern enforces that.
- **`EnvironmentsFacade.ts`** — `EnvironmentsQuery(org, repo)` (method, same reasoning as above);
  `createEnvironment`/`deleteEnvironment` are shared `injectMutation` fields (mutations are safe as
  fields — they don't fetch anything until `.mutate()`/`.mutateAsync()` is actually called) with
  optimistic updates against the `['environments', token, org, repo]` cache key.
- **`RunnersFacade.ts`** — `RunnersQuery(scope)`, `refetchInterval: 30_000`, `enabled: !!token &&
  !!scope()`.
- **`LedgerFacade.ts`** — `LedgerQuery(scope)`. Internally composes `EnvironmentsFacade`'s and
  `ScopesFacade`'s queries — `DashboardShellComponent` doesn't need to know that building the
  ledger requires knowing the environment list and account type first — builds the list of
  org/repo/environment-level `LedgerJob`s, and runs them via `RunLedgerJobs` from
  `LedgerSupport.ts`.
- **`ItemMutationsFacade.ts`** — six `injectMutation` fields: `createVariable`, `updateVariable`,
  `deleteVariable`, `putSecret`, `renameSecret`, `deleteSecret`. Each has `onMutate`/`onError` doing
  an optimistic patch of the ledger cache (via private `SnapshotLedger`/`RestoreLedger`/
  `UpdateLedgerItems` helpers using `injectQueryClient()`) and a rollback on failure.
- **`CopyFacade.ts`** — `CopyTo(kind, name, value, targets, options)`, composing
  `ItemMutationsFacade`'s per-item mutations via `Promise.allSettled`; `isPending` is a
  `computed()` signal.
- **`LedgerSupport.ts`** — pure functions shared by `LedgerFacade`/`ItemMutationsFacade`:
  `SameScope`, `ErrorMessage`, `OptimisticVariable`, `OptimisticSecret`, `RunLedgerJobs`,
  `JobLabel`; plus the `LedgerPartialError`/`LedgerLockedSection`/`LedgerResult`/`LedgerJob` types.
  Pulled out as free functions (not facade methods) because both facades need them and neither
  should depend on the other for pure data-shaping logic.
- **`DeleteEverywhereFacade.ts`** — `DeleteFrom(kind, name, targets)`, composing
  `ItemMutationsFacade.deleteVariable`/`deleteSecret` via `Promise.allSettled`, mirroring
  `CopyFacade`'s shape exactly (same batching pattern, same reuse of `ItemMutationsFacade` rather
  than calling gateways directly). Used only by `CompareViewComponent`'s row-delete — a `LedgerRow`
  deletes from one scope via `ItemMutationsFacade` directly, while a compare-view row deletes a
  name from *every* scope it's set in, which is what this Facade exists to batch.
- **`CopySupport.ts`** — `CopyTarget`, `CopyResult`, `DeleteEverywhereTarget`,
  `DeleteEverywhereResult` types shared between `CopyFacade` and `DeleteEverywhereFacade`.

## Design rationale: methods vs. fields for queries

The rule of thumb applied throughout this folder: **if a query should only run when a specific
component actually wants that specific data, expose it as a method** (`FooQuery(...)` called from
within the consuming component's own injection context, per `injectQuery`'s requirement that it run
in a component/service constructor or field initializer). Only use a shared field for a query that
every consumer of the facade always wants unconditionally — none of the queries here qualify, which
is why every query in this folder is a method and only mutations are fields.

## Why `LedgerFacade` composes `EnvironmentsFacade`/`ScopesFacade` internally

Keeping that composition inside `LedgerFacade` (not pushed up into the component) keeps the
component itself a thin presentation layer, consistent with this project's Facade pattern
rationale in `docs/Architecture.md`.
