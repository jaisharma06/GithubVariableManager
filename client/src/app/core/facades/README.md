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
  optimistic updates against the `['environments', token, org, repo]` cache key. `renameEnvironment`
  (Phase 3c) is one `IEnvironmentsGateway.RenameEnvironment` call now rather than three sequential
  mutations (create env -> copy each variable via `CopyFacade` -> delete old env), since that
  orchestration moved server-side (`api/Services/EnvironmentRenameService.cs`). Deliberately no
  optimistic `onMutate` patch here, unlike `createEnvironment`/`deleteEnvironment` — hand-rolling an
  equivalent multi-item optimistic patch (a new environment appearing, N variables appearing under
  it, the old environment disappearing, all from one mutation) is high-risk for low payoff. Instead
  its `onSuccess` invalidates both the `['environments', …]` and `['ledger']` queries, mirroring
  `ItemMutationsFacade.renameSecret`'s `onSuccess` invalidation from Phase 3b exactly and accepting
  a brief refetch flicker as an honest tradeoff. A later, non-phase-numbered addition,
  `copyEnvironmentVariables`, is another shared `injectMutation` field: one
  `ILedgerGateway.CopyEnvironmentVariables` call (`api/Services/EnvironmentVariableCopyService.cs`
  does the listing/skip-if-exists/value-transform/per-variable-failure-isolation server-side).
  Deliberately no optimistic `onMutate` here either, same reasoning as `renameEnvironment` — N
  variables appearing at an arbitrary, possibly cross-repo/cross-org destination is high-risk to
  hand-fake; `onSuccess` invalidates `['ledger']` broadly, accepting the same brief-flicker
  tradeoff. Consumed by `features/dashboard/CopyEnvironmentDialog.component.ts`.
- **`RunnersFacade.ts`** — `RunnersQuery(scope)`, `refetchInterval: 30_000`, `enabled: !!token &&
  !!scope()`. As of Phase 4 (the ASP.NET Core migration's Runners vertical), this Facade no longer
  branches on `scope().repo` to pick between `ListRepoRunners`/`ListOrgRunners` — it just forwards
  `org`/`repo` to `IRunnersGateway`'s single `ListRunners` method, since that branching moved
  server-side (`api/Services/RunnersService.cs`).
- **`LedgerFacade.ts`** — `LedgerQuery(scope)`. As of Phase 3a (the ASP.NET Core migration's
  Ledger vertical), this is a thin wrapper around one `injectQuery` calling
  `ILedgerGateway.GetLedger` — the variables/secrets/environment fan-out and locked-section
  classification that used to be assembled here (composing `EnvironmentsFacade`/`ScopesFacade`
  internally, running `LedgerJob`s via `RunLedgerJobs`) now lives server-side in
  `api/Services/LedgerService.cs`. `DashboardShellComponent` still queries `EnvironmentsFacade`/
  `ScopesFacade` directly for its own needs (the sidebar's environment list, the header's
  `showOrgLevel`) — that usage is unrelated to this Facade and unaffected by the shrink.
  `ExportLedger(org, repo?)` is a plain `async` passthrough to `ILedgerGateway.ExportLedger`,
  deliberately **not** an `injectQuery`/`injectMutation` field: it's a one-shot imperative download
  with no cache-worthy state (nothing about "did I export" belongs in the TanStack Query cache), the
  same reasoning `WorkflowsFacade.DeleteRuns` already established for this Facade's start+poll bulk
  delete — the caller (`DashboardShellComponent`) owns its own `exporting`/`exportError` pending
  signals rather than reading `isPending`/`error` off a mutation object. A later, non-phase-numbered
  addition: `ResolveVariable(scope, level, name, value)` is another plain `async` passthrough (to
  `ILedgerGateway.ResolveVariable`), same one-shot-imperative-not-a-query shape as `ExportLedger` —
  preview-only composite-variable resolution (`POST /api/ledger/variables/resolve`) with no
  cache-worthy state; `ItemEditorPanelComponent`'s live-resolve preview owns its own
  `resolvePreview`/`resolvingPreview` signals rather than this Facade wrapping the call in an
  `injectQuery`.
- **`ItemMutationsFacade.ts`** — six `injectMutation` fields: `createVariable`, `updateVariable`,
  `deleteVariable`, `putSecret`, `renameSecret`, `deleteSecret`. Each has `onMutate`/`onError` doing
  an optimistic patch of the ledger cache (via private `SnapshotLedger`/`RestoreLedger`/
  `UpdateLedgerItems` helpers using `injectQueryClient()`) and a rollback on failure. `renameSecret`
  (Phase 3b) is one `ISecretsGateway.RenameSecret` call now rather than a sequential
  `PutSecret`-then-`DeleteSecret`, since that orchestration (plus the sealing it needs) moved
  server-side; its `onSuccess` handler invalidates the `['ledger']` query when the backend reports
  `deleteSucceeded: false` — the old name genuinely still exists on GitHub in that case, so the
  optimistic "clean rename" patch from `onMutate` would otherwise be silently wrong until the next
  unrelated refetch. Every other mutation *also* has an
  unconditional `onSuccess` invalidating `['ledger']` — a claim in an earlier revision of this doc
  that they "don't need one" predates composite variables and no longer holds: a composite item's
  `resolvedValue`/`unresolvedReferences` are computed server-side from every *other* variable in
  the ledger response (`LedgerSupport.ts`'s `IsCompositeValue`/`ExtractReferences` describe the
  syntax; `api/Services/CompositeVariableResolver.cs` does the resolving), and the optimistic patch
  here only ever touches the mutated row itself — it never recomputes any *other* row's resolution.
  Without the `onSuccess` invalidation, saving/deleting a variable or secret left every composite
  row that referenced it stale until an unrelated event happened to trigger a refetch (30s
  `staleTime` elapsing, window refocus, or a hard reload building a fresh `QueryClient`). (Phase 6
  removed
  the seventh field, `upsertVariable` — it existed only for `CopyFacade.CopyTo`'s old client-side
  variable branch, which now calls `ILedgerGateway.Copy` directly instead; see the `CopyFacade.ts`
  entry below.)
- **`CopyFacade.ts`** — `CopyTo(kind, name, value, targets, options)`. As of Phase 6, one
  `ILedgerGateway.Copy` call, fanned out server-side (`Services/CopyService.cs`) over every target,
  rather than a client-side `Promise.allSettled` composing `ItemMutationsFacade`'s per-item
  mutations — this drops the `ItemMutationsFacade` dependency entirely. Wraps the call in its own
  `injectMutation` field so `isPending` is a real TanStack signal (`this.copy.isPending`) rather
  than an OR of unrelated mutations' pending states. Deliberately no optimistic `onMutate` patch;
  `onSuccess` invalidates the `['ledger']` query instead, the same tradeoff
  `EnvironmentsFacade.renameEnvironment` already made in Phase 3c when its 3-step client sequence
  collapsed to one backend call — hand-rolling an equivalent multi-target optimistic patch is
  high-risk for low payoff, so a brief refetch flicker is accepted as an honest tradeoff. Note this
  Facade/its `targets`/`options` shape is unchanged by `CopyItemDialogComponent`'s cross-repo/
  cross-org destination picker (`features/ledger/CrossRepoTargetPicker.component.ts`) — that
  feature only widens what the dialog can *assemble* into `targets` before calling `CopyTo`; the
  single-batch `options` value (one visibility/selected-repos choice per call) is exactly why the
  dialog has to block a submit needing two different orgs' `'selected'`-visibility at once, rather
  than something this Facade had to change to support.
- **`LedgerSupport.ts`** — pure functions shared by `ItemMutationsFacade` (and the response-shaping
  types `ILedgerGateway`/`BackendLedgerGateway.service.ts` consume): `SameScope`, `ErrorMessage`,
  `OptimisticVariable`, `OptimisticSecret`; plus the `LedgerPartialError`/`LedgerLockedSection`/
  `LedgerResult` types. `RunLedgerJobs`/`JobLabel`/`LedgerJob` (the client-side fan-out) were
  deleted once that logic moved server-side — see `LedgerFacade.ts` above. A later,
  non-phase-numbered addition: composite-variable support (Azure-App-Config-style `$(OtherVarName)`
  formulas, variables only). `IsCompositeValue`/`ExtractReferences` are pure regex helpers kept in
  sync **by hand** with `api/Services/CompositeVariableResolver.cs`'s `ReferencePattern` (same
  pattern, same "letters/digits/underscore, must not start with a digit" name rule) — deliberately
  duplicated rather than shared across the stack, since there's no code-sharing mechanism between
  `client/` and `api/` in this repo. Two separate `RegExp` instances back them (one without the
  global flag for `.test()`, one with it for `.matchAll()`) — a single global-flag regex would carry
  `lastIndex` state between calls and silently break repeated `.test()` calls. `FindDependents(items,
  name, scope)` is a reverse-dependency scan over already-fetched ledger data: every variable whose
  formula references `name` at `scope`, restricted by a private `InScopeChain` helper to items that
  could actually *see* that name per the environment > repository > organization precedence chain
  (so a same-named variable at an unrelated scope never shows up as a false positive) — used by
  `DashboardShellComponent`/`CompareViewComponent` to warn "N other variables reference this" before
  a delete. Kept here as a free function (this file's existing `SameScope`/`OptimisticVariable`
  convention) rather than a Facade method, since it's a synchronous scan over data the caller already
  has, not a query/mutation.
- **`WorkflowsFacade.ts`** — `WorkflowsQuery(org, repo)`/`WorkflowRunsQuery(org, repo, workflowId)`/
  `WorkflowRunDetailQuery(org, repo, runId)` (methods, same reasoning as `ScopesFacade`/
  `EnvironmentsFacade` above); `deleteWorkflowRun`/`rerunWorkflowRun` are shared `injectMutation`
  fields, each for a single run. `WorkflowRunsQuery` polls conditionally —
  `refetchInterval: (query) => AllRunsSettled(query.state.data) ? false : WORKFLOW_RUNS_POLL_INTERVAL_MS`
  (5s) — re-fetching while any displayed run is still in flight and stopping entirely once every
  visible run has reached `status === 'completed'`, unlike `RunnersFacade`'s unconditional 30s poll
  above (a runner's online/offline/busy status never settles the way a run's terminal state does, so
  the same "poll forever" approach would just be wasted calls here). `AllRunsSettled` is exported and
  directly unit-tested (`WorkflowsFacade.spec.ts`) as the one piece of real decision logic in the
  poll. `WorkflowRunDetailQuery` — added for the run-detail panel — is the single-run analog: same
  conditional-polling philosophy, gated by a separate exported `DetailRunSettled(detail)` helper
  (deliberately not generalized into one shared function with `AllRunsSettled`, since the two work
  off different shapes — a `WorkflowRun[]` vs. one `WorkflowRunDetail` — and this codebase prefers
  boring duplication over coupling two shapes through a generic). `rerunWorkflowRun`'s `onSuccess`
  invalidates both the `['workflow-runs', …]` list query and the `['workflow-run-detail', …]` query
  for that run, so the run-detail panel and the runs list both pick up the new attempt without a
  manual refresh. `WorkflowsQuery` (the workflow list itself) is not polled. `DeleteRuns(org, repo, workflowId, runIds,
  onProgress?)` bulk-deletes a caller-chosen set of a workflow's runs — as of Phase 5 (the ASP.NET
  Core migration's Workflows vertical), this shrank from its own client-side chunking
  (`DELETE_CHUNK_SIZE`, one `DeleteWorkflowRun` call per run via sequential `Promise.allSettled`
  chunks, plus a local `.status === 403` permission check) to a plain start+poll loop:
  `IWorkflowsGateway.StartRunCleanup` kicks off the job, then `PollRunCleanup` is awaited
  repeatedly (with a `Delay` helper between polls — no shared delay utility existed in this
  codebase) until the backend reports it complete, forwarding each poll's `done`/`total` to
  `onProgress` and returning the backend's own `succeededIds`/`failedIds`/`permissionDenied`
  classification. The chunked fan-out and permission classification now live server-side
  (`api/Services/WorkflowRunCleanupService.cs`, `Auth/PermissionErrorClassifier.cs`).
- **`DeleteEverywhereFacade.ts`** — `DeleteFrom(kind, name, targets)`. Structural twin of
  `CopyFacade`'s Phase 6 rewrite: one `ILedgerGateway.DeleteEverywhere` call, fanned out
  server-side (`Services/DeleteEverywhereService.cs`) over every target, same dropped-
  `ItemMutationsFacade`-dependency and dropped-optimistic-update tradeoff as `CopyFacade` (see its
  entry above). Used only by `CompareViewComponent`'s row-delete — a `LedgerRow` deletes from one
  scope via `ItemMutationsFacade` directly, while a compare-view row deletes a name from *every*
  scope it's set in, which is what this Facade exists to batch.
- **`CopySupport.ts`** — `CopyTarget`, `CopyResult`, `DeleteEverywhereTarget`,
  `DeleteEverywhereResult` types shared between `CopyFacade` and `DeleteEverywhereFacade`. A later,
  non-phase-numbered addition: `EnvironmentVariableCopyResult`/`EnvironmentVariableCopyFailure` —
  the wire-shape port of `api/`'s `CopyEnvironmentVariablesResponse`/`VariableCopyFailureResponse`,
  used by `ILedgerGateway.CopyEnvironmentVariables` and `EnvironmentsFacade.copyEnvironmentVariables`
  (not `CopyFacade`/`CopyResult` above — a different operation shape, see the `EnvironmentsFacade.ts`
  entry above and `docs/Architecture.md` for why).

## Design rationale: methods vs. fields for queries

The rule of thumb applied throughout this folder: **if a query should only run when a specific
component actually wants that specific data, expose it as a method** (`FooQuery(...)` called from
within the consuming component's own injection context, per `injectQuery`'s requirement that it run
in a component/service constructor or field initializer). Only use a shared field for a query that
every consumer of the facade always wants unconditionally — none of the queries here qualify, which
is why every query in this folder is a method and only mutations are fields.

