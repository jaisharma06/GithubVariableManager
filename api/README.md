# api/

The ASP.NET Core backend (.NET 9) that owns GitHub Variables Manager's business/API decision logic
in full — see `docs/Architecture.md`'s "The ASP.NET Core migration" section for the full picture
and phased rollout that got it here. Every GitHub resource's vertical has migrated: `client/`
never decides anything about GitHub state itself, only renders what this backend returns.

## Projects

- `src/GithubVariablesManager.Api/` — the Web API itself (`GithubVariablesManager.Api.sln` at the
  repo-`api/` root ties both projects together).
- `tests/GithubVariablesManager.Api.Tests/` — xUnit tests, one project mirroring the main one's
  layout.

## Layout inside `src/GithubVariablesManager.Api/`

Mirrors `client/src/app/core`'s Gateway/Facade split conceptually — see `docs/CodingStandards.md`
for why each layer stays single-purpose:

- `Program.cs` — minimal-API bootstrap: CORS (comma-separated `WEB_ORIGIN` env var pattern), the
  `GET /health` check, DI registration, and route mapping (`MapAuthEndpoints()`). The CORS policy
  also carries `.WithExposedHeaders("Content-Disposition")` — added for the ledger export feature
  (see `Services/LedgerExportService` below): `Content-Disposition` isn't one of the handful of
  response headers CORS exposes to browser JS by default (`Cache-Control`/`Content-Language`/
  `Content-Type`/`Expires`/`Last-Modified`/`Pragma` only), so without this,
  `BackendLedgerGateway.service.ts`'s `ExportLedger` could still download the file's bytes fine but
  could never read the filename `GET /api/ledger/export` suggests via that header — `response.headers.get('Content-Disposition')`
  would just come back `null` in the browser even though curl/Postman see it. Worth remembering if
  CORS config here is ever touched again without this context: removing that exposed header doesn't
  break the export, it just silently degrades every downloaded filename to the gateway's
  locally-recomputed fallback.
- `Auth/` — the stateless bearer-token pass-through (`IBearerTokenAccessor` /
  `HttpContextBearerTokenAccessor`, extracts the incoming `Authorization: Bearer` header per
  request; `GitHub/GitHubClientFactory` attaches the same token to outbound Octokit calls) and the
  centralized permission-error classification (`PermissionErrorClassifier`, `GitHubPermissionError`,
  `PermissionErrorExceptionHandler`) — the one place a GitHub 403/404 (or any other Octokit
  `ApiException` status) becomes a structured `{ locked, status, message }` shape, replacing four
  independent classification sites that used to exist in Angular (`LedgerSupport.RunLedgerJobs`,
  `GithubEnvironmentsGateway`, `RunnersPanel.component.ts`, `WorkflowsFacade`).
  `PermissionErrorExceptionHandler` is wired globally (`app.UseExceptionHandler()`), so any endpoint
  can just let an `Octokit.ApiException` propagate uncaught.
- `Endpoints/` — route mapping, one file per resource, mirroring Gateway granularity.
  `AuthEndpoints.cs` (the Auth vertical, live) maps `/api/auth/github/client-id`,
  `/api/auth/github/device-code`, `/api/auth/github/device-token`, and `/api/auth/viewer`.
  `ScopesEndpoints.cs` (the Scopes vertical, live) maps `/api/scopes/orgs`, `/api/scopes/repos`,
  `/api/scopes/orgs/{org}/repos`, and `/api/scopes/accounts/{login}/type`. `LedgerEndpoints.cs`
  (the Ledger vertical — read + Variables CRUD live as of Phase 3a, Secrets CRUD live as of Phase
  3b, Environments CRUD/rename live as of Phase 3c, batch Copy/Delete-everywhere live as of Phase
  6, closing out the vertical) maps `GET /api/ledger` (the merged variables + secrets +
  environment-fan-out read), `POST`/`PATCH`/`DELETE /api/ledger/variables` (create,
  rename+update, delete), `PUT`/`PATCH`/`DELETE /api/ledger/secrets` (upsert-with-sealing,
  rename-with-reported-partial-outcome, delete — see `Services/` below for the rename design),
  `GET`/`POST`/`DELETE /api/ledger/environments` plus `POST /api/ledger/environments/rename` (list,
  create, delete, and the create-copy-conditionally-delete rename orchestration — see
  `Services/EnvironmentRenameService` below), and `POST /api/ledger/copy`/`POST
  /api/ledger/delete-everywhere` (Phase 6 — batch fan-out over a caller-supplied target list, one
  endpoint per operation with internal `kind` branching rather than separate per-kind endpoints —
  see `Services/CopyService`/`Services/DeleteEverywhereService` below). `PUT /api/ledger/variables`
  (upsert-by-name) is gone as of Phase 6: it existed only for the old client-side
  `CopyFacade.CopyTo`'s variable branch, which now calls `POST /api/ledger/copy` instead. A
  post-migration addition, `GET /api/ledger/export` (same `org`/`repo` query params as `GET
  /api/ledger`) returns a downloadable `.xlsx` workbook of the scope's ledger via `Results.File(...)`
  — see `Services/LedgerExportService` below for what it renders and why; it shares `GET
  /api/ledger`'s `LedgerUnavailableException` local-catch-to-502 handling exactly, so an export
  fails the same way the read screen does rather than silently producing an empty/misleading file.
  A later, non-phase-numbered addition, `POST /api/ledger/environments/copy-variables`, sits on this
  same route group next to `/environments/rename`: copies every variable from one environment into
  another (same repo or cross-repo/cross-org), skipping any name already present at the destination
  and substring-replacing the source environment's name with the destination's inside each copied
  value — see `Services/EnvironmentVariableCopyService` below for the full design, including why
  it's a sibling to `EnvironmentRenameService`/`CopyService` rather than an extension of either.
  Another later, non-phase-numbered addition, composite-variable support (Azure-App-Config-style
  `$(OtherVarName)` formulas, variables only — see `Services/CompositeVariableResolver`/
  `Services/CompositeManifestService` below for the full design, including the manifest-based
  redesign that replaced this feature's original value-is-the-formula model): `POST
  /api/ledger/variables/resolve` is a preview-only route on this same group (never writes
  anything — used by `client/`'s `ItemEditorPanelComponent` for live authoring feedback), and the
  existing `POST`/`PATCH /api/ledger/variables` handlers gain a local
  `catch (CompositeCircularReferenceException)` → `400`, the same local-catch-to-4xx shape
  `EnvironmentRenameValidationException` already established, since a circular formula never touches
  GitHub in the first place — both handlers now return an `UpsertVariableResponse` body
  (`ManifestSynced`/`ManifestSyncError`) reporting whether the best-effort composite-manifest update
  that follows a successful variable write also succeeded, instead of a bare `200`. `POST
  /api/ledger/variables/sync` is the manual Sync action (replacing the old "flatten to literal" 1:1
  at the same UI trigger point, but now routine/non-destructive since the formula survives every
  sync) — the client sends only the target's identity (`SyncVariableRequest`, no formula/value of
  its own); the server re-reads the formula from its own scope's manifest and recomputes it against
  current sibling values, catching `CompositeFormulaNotFoundException` → `400` (the name isn't
  actually tracked as composite) alongside the existing `CompositeCircularReferenceException` → `400`
  catch. A later, non-phase-numbered addition, the bulk complement to that per-row Sync: `POST
  /api/ledger/variables/sync-all` — one global "Sync all" action, fanning out over a
  client-computed target list (`SyncAllVariablesRequest.Targets`, reusing `SyncVariableRequest` as
  the per-target shape — the client already knows which items are composite from its last `GET
  /api/ledger` read, so the server never re-enumerates manifests from scratch for this route) via a
  new `Services/SyncAllVariablesService.cs` (see `Services/` below). Catches
  `CompositeFormulaNotFoundException`/`CompositeCircularReferenceException` **per target** (unlike
  this single-item handler above, which maps either to a `400` for the whole request), since a bulk
  sync must not let one bad formula among many targets abort the batch — each target's outcome
  (`Ok`/`Synced`/`ResolvedValue`/`Message`) is reported independently in `SyncAllVariablesResponse`.
  `GET /api/ledger` itself needed no route change for either the original
  feature or its manifest redesign — the composite fields ride along inside the existing
  `LedgerItemResponse` (see `Contracts/` below), populated by a post-fan-out pass inside
  `LedgerService.GetLedgerAsync` (see `Services/` below) that now reads no extra GitHub calls beyond
  what that pass already fetched (the manifest variable rides along in the same
  `ListVariablesAsync` response every scope's variables job makes).
  `RunnersEndpoints.cs` (the Runners vertical, live as
  of Phase 4) maps `GET /api/runners` — self-hosted runners for the dashboard's runners panel, with
  an optional `repo` query param covering both an org-only scope (omitted) and a repo scope
  (present); the org-vs-repo branching that used to live in Angular's `RunnersFacade` moved into
  `Services/RunnersService.cs`. `WorkflowsEndpoints.cs` (the Workflows vertical, live as of Phase
  5 — the last individual-resource vertical) maps `GET /api/workflows` (list a repo's Actions
  workflows), `GET /api/workflows/runs` (a workflow's runs, single page), `DELETE
  /api/workflows/runs` (single-run delete, query params not a body), and the chunked bulk-delete's
  start+poll pair: `POST /api/workflows/runs/cleanup` (202 + a job id) and `GET
  /api/workflows/runs/cleanup/{jobId}` (progress, 404 if the id is unknown) — see
  `Services/WorkflowRunCleanupService` below for why bulk-delete needs two endpoints instead of
  one. Post-Phase-5, `WorkflowsEndpoints.cs` grew two more routes for the run-detail panel/rerun
  feature: `GET /api/workflows/runs/{runId:long}` (one run's full detail — the run itself plus every
  job and its steps, fully paginated) and `POST /api/workflows/runs/rerun` (bodyless, query params —
  matching `DELETE /api/workflows/runs`'s existing convention). The read-by-path-id vs.
  write-by-query-param asymmetry between these two is intentional, not something to unify: the read
  matches the existing `GET /runs/cleanup/{jobId}` precedent for a specific-resource lookup, while
  the write matches `LedgerEndpoints.cs`'s bodyless-write-action convention. Every resource-specific Gateway `client/` used to call `api.github.com` directly now has a
  `Backend*Gateway.service.ts` counterpart calling this backend instead, and both batch-operation
  endpoints are live on both sides: `client/`'s `CopyFacade`/`DeleteEverywhereFacade` already cut
  over to call `POST /api/ledger/copy`/`POST /api/ledger/delete-everywhere` in one shot each,
  instead of composing `ItemMutationsFacade`'s single-item mutations client-side. This closes out
  every GitHub resource's vertical and both batch operations — the whole migration's new
  backend/frontend work is complete.
- `Services/` — orchestration/business logic, mirroring Facade responsibility.
  `DeviceFlowService` (OAuth client id + device-flow relay orchestration, including the
  GitHub-vocabulary classification — `authorization_pending` → `pending`, etc. — moved server-side
  from Angular's old `LocalOAuthGateway`), `ViewerService` (viewer lookup shared by both sign-in
  methods), and `ScopesService` (orgs/repos lookup for the scope picker + account-type check) are
  live from earlier phases. Phase 3a adds `LedgerService` (the variables + secrets + environment
  fan-out and 403/404-vs-other-error classification that used to live in Angular's
  `LedgerFacade`/`LedgerSupport.RunLedgerJobs`, now a direct 1:1 server-side port; throws
  `LedgerUnavailableException`, co-located in `LedgerService.cs` itself matching the
  `OAuthRelayException`-in-`DeviceFlowService.cs` precedent, when every fan-out job hits a genuine
  non-403/404 error). A later, non-phase-numbered addition: `LedgerService.GetLedgerAsync`'s result
  now runs through a private `ResolveComposites` post-fan-out pass (composite-variable support — see
  `CompositeVariableResolver`/`CompositeManifestService` below) before it's returned. As of the
  manifest-based redesign, compositeness is derived from a name being a key in its own scope's
  manifest (`CompositeManifestService.ParseManifest`, parsed from the manifest variable each scope's
  `VariablesJob` already fetches and filters out of the returned item list) — never from
  regex-matching the item's `Value` the way the original design worked. `ResolveComposites`
  populates `Formula` (the raw formula text from the manifest) and recomputes `ResolvedValue`/
  `UnresolvedReferences` fresh against the other variables already fetched in that same request —
  still no extra GitHub calls, and still nothing kept "live" between reads, since the whole response
  is recomputed fresh on every call; `ResolvedValue` now doubles as a staleness signal (`Value !=
  ResolvedValue` means a dependency changed since this item's last write/sync), since `Value` itself
  is always already the resolved literal now, not the formula. `EnvironmentsService` (`ListEnvironmentsAsync`, with its own local catch
  turning a "no environments configured" 404 into an empty list rather than a locked section; gains
  `CreateEnvironmentAsync`/`DeleteEnvironmentAsync` thin pass-throughs in Phase 3c). `ItemMutationService`
  starts with the four variable write methods in Phase 3a and gains three secret write methods in
  Phase 3b: `PutSecretAsync` (fetches the scope's current public key, seals via
  `SecretSealingService`, then PUTs — upsert-only, matching GitHub's own secrets PUT semantics, so
  unlike variables there's no separate create/upsert split), `DeleteSecretAsync`, and
  `RenameSecretAsync` (put-new-name-then-delete-old, since GitHub has no rename API for secrets;
  reports `RenameSecretResponse.DeleteSucceeded: false` with GitHub's own error message rather than
  ever throwing/5xx-ing when only the delete step fails, since the backend can't make the two steps
  transactional and a 5xx would wrongly tell the client nothing changed). A later, non-phase-numbered
  addition, since replaced by its own manifest-based redesign: `CreateVariableAsync`/
  `UpdateVariableAsync` now run a private `ResolveForWriteAsync` first (a no-op unless the value is
  actually composite), resolving the formula against the item's scope chain and throwing
  `CompositeCircularReferenceException` on a genuine cycle — caught locally in
  `Endpoints/LedgerEndpoints.cs` and mapped to a `400` before anything touches GitHub. **Unlike the
  original design, the value actually written to GitHub is always the resolved literal, never the
  raw formula** — the formula itself is tracked separately, best-effort, in the scope's hidden
  manifest variable (`CompositeManifestService`, injected alongside `CompositeVariableResolver`) via
  a private `SyncManifestEntryAsync` called *after* the variable write succeeds — this ordering is
  deliberate: a manifest-write failure after a successful variable write still leaves a working,
  correct literal on GitHub (recoverable by re-saving), while the reverse order would risk an
  orphaned manifest entry for a variable that was never actually written. Both methods now return
  `UpsertVariableResponse { ManifestSynced, ManifestSyncError }` reporting that best-effort step's
  own outcome. `DeleteVariableAsync` does silent, best-effort manifest cleanup (a swallowed
  `Octokit.ApiException` — lower stakes than a create/update manifest failure, since the worst case
  is one inert dead JSON key vs. losing live formula-awareness for a variable that still exists). A
  new method, `SyncCompositeVariableAsync` (`POST /api/ledger/variables/sync`'s handler), is the
  manual recovery/refresh action replacing the old "flatten to literal" 1:1: re-reads the formula
  from the scope's manifest (throwing `CompositeFormulaNotFoundException` if the name isn't actually
  tracked), recomputes it fresh, and overwrites the real GitHub value — the manifest itself is
  untouched, so the formula survives every sync. A later, non-phase-numbered addition, alongside a
  new private `ResolveFromManifestAsync` helper the two now share (re-reads the formula from the
  manifest, builds the sibling-value lookup, resolves, throws the same two domain exceptions either
  caller already documents): `SyncCompositeVariableIfStaleAsync`, the "Sync all" batch action's
  per-item primitive (called by `SyncAllVariablesService` below). Kept as its own method rather than
  an optional parameter on `SyncCompositeVariableAsync`, because the two have genuinely different
  write contracts — a user explicitly clicking Sync on one row must still write even when the value
  is already current (`SyncCompositeVariableAsync`'s existing, unconditional-write behavior, left
  untouched), while a global batch sync should skip writing to every already-current item rather than
  issuing N no-op writes; the skip costs nothing extra, since the item's current value is read for
  free as part of `CompositeVariableResolver.BuildLookupAsync`'s own scope-chain lookup, which already
  includes this scope's own variables (including this one). `UpsertVariableAsync`
  (the Copy/replicate-to-environments write path) deliberately does **not** run the circular-check/
  manifest-tracking logic at all — copying a composite's resolved literal into a scope that's merely
  missing one of its referenced names is an explicitly allowed, non-error outcome, and a copy
  destination deliberately does not get an auto-created manifest entry either, since repurposing a
  copied value into a live formula at a new scope is an explicit re-authoring act, not an implicit
  side effect of a value copy (see `CompositeVariableResolver`/`CompositeManifestService` below).
  `SecretSealingService`
  (Phase 3b) is a new, narrow class: libsodium sealed-box encryption against a scope's public key,
  via `Sodium.Core` — kept separate from `ItemMutationService` the same way the old Angular
  `SecretSealingService.ts` was kept separate from `GithubSecretsGateway.service.ts` (crypto
  mechanics are a distinct concern from GitHub call orchestration). `EnvironmentRenameService`
  (Phase 3c, closing out the Ledger vertical) is the environment equivalent of
  `ItemMutationService.RenameSecretAsync`'s outcome-reporting philosophy: GitHub has no rename API
  for environments, so `RenameEnvironmentAsync` creates the new environment, copies every
  environment-level variable's value across, then conditionally deletes the old one (skipped unless
  the old environment has no secrets or the caller explicitly requests `DeleteOldAnyway`). New-name
  validation (empty/bad pattern/same-as-old/already-exists) throws a local-only
  `EnvironmentRenameValidationException` before anything touches GitHub; environment creation is the
  one step allowed to propagate `Octokit.ApiException` uncaught (the point of no return); every step
  after that is caught locally and reported in `RenameEnvironmentResponse` — critically, a partial
  variable-copy failure leaves the old environment in place, never deleted, regardless of
  `DeleteOldAnyway`, since it's the only remaining source of truth for whatever didn't copy.
  `RunnersService` (Phase 4) is the first vertical after Scopes to go straight through Octokit's
  typed client rather than `ActionsRestClient`: Octokit.NET 14.0.0 *does* ship a real typed client
  for self-hosted runners (`Actions.SelfHostedRunners`, confirmed via reflection against the
  installed assembly), unlike Actions Variables/Secrets/Environments — so `ListRunnersAsync` calls
  `ListAllRunnersForOrganization`/`ListAllRunnersForRepository` directly, same shape as
  `ScopesService`. Capped at a single 100-item page, matching the pre-migration Angular Gateway's
  `per_page=100` single-page behavior exactly. `WorkflowsService` (Phase 5) also goes straight
  through a typed Octokit client (`Actions.Workflows`/`Actions.Workflows.Runs`, confirmed real via
  reflection — unlike Ledger's resources, Workflows has one) — `ListWorkflowsAsync` fully paginates
  (Octokit's `Workflows.List` returns one page at a time, so this loops it manually,
  total-count-driven, the same idea as `ActionsRestClient`'s pagination but around a typed call
  instead of `Connection.Get<T>`, preserving the pre-migration Gateway's full-pagination behavior
  rather than silently capping it), while `ListWorkflowRunsAsync` stays single-page
  (caller-supplied `perPage`, matching today's display-only usage). Post-Phase-5, `WorkflowsService`
  gained `GetWorkflowRunDetailAsync` (the run itself via `Actions.Workflows.Runs.Get`, plus every
  job and its steps via a fully-paginated `Actions.Workflows.Jobs.List` loop — same total-count-driven
  shape as `ListWorkflowsAsync`, since a detail view's whole point is completeness, unlike
  `ListWorkflowRunsAsync`'s deliberate single-page cap) and `RerunWorkflowRunAsync`
  (`Actions.Workflows.Runs.Rerun`, no try/catch, propagating `Octokit.ApiException` uncaught same as
  every other single-item mutation in this backend). Both share a private `ExtractCommitSubject`
  helper that reads a run's `HeadCommit.Message`'s first line for `WorkflowRunResponse`/
  `WorkflowRunDetailResponse`'s `CommitMessage` field — deliberately not `WorkflowRun.DisplayTitle`,
  which is GitHub's own computed title and silently changes if the workflow's YAML sets a
  `run-name:` directive. `WorkflowRunCleanupService`
  (Phase 5) is the chunked bulk-run-delete, and the one Service in this backend registered
  `AddSingleton` instead of `AddScoped` — a load-bearing choice, not a style one: the "start"
  request and every "poll" request after it are separate HTTP requests with separate DI scopes, so
  job-progress state that must survive between them can't live in a Scoped service. Being
  Singleton means it can't constructor-inject `GitHubClientFactory`/`IBearerTokenAccessor` (both
  Scoped/`HttpContext`-bound) — instead `StartCleanup` takes the caller's bearer token as a plain
  parameter, captured from the real request's scope, and uses it to build a one-off Octokit client
  for a detached `Task.Run` background job that chunks the run ids (5 at a time, `Task.WhenAll`
  per chunk — the server-side home of the chunking/concurrency-bounding decision that used to live
  in Angular's `WorkflowsFacade.DeleteRuns`) and tracks `Done`/`Total`/`Completed`/`SucceededIds`/
  `FailedIds`/`PermissionDenied` in an in-memory `ConcurrentDictionary<Guid, JobState>`, evicted
  ~10 minutes after completion. Permission-denied aggregation reuses
  `Auth.PermissionErrorClassifier.Classify(...).Locked` rather than a hand-rolled status check —
  this closes out the last of the four originally-duplicated permission-classification sites
  (`WorkflowsFacade`/`WorkflowsView.component.ts`'s own `.status === 403` check). Two caveats
  worth being explicit about, documented on the class itself: (1) the bearer token is held as a
  plain in-memory string for the duration of one background job — typically seconds, never logged
  or written to disk, discarded with the rest of the job on eviction, a deliberate (and narrow)
  departure from this backend's usual "a token never outlives one request" shape, accepted because
  there's no other way to give a background continuation credentials after its starting request
  has already returned; (2) in-memory job state doesn't survive a backend restart — a poll against
  a since-lost job id 404s, and the client is expected to treat that as a hard failure rather than
  poll forever, an accepted tradeoff of staying free of any database per this project's
  non-negotiable "no server-side database, ever" rule.
  `CopyService`/`DeleteEverywhereService` (Phase 6, closing out the Ledger vertical's batch
  operations) replace `client/`'s old `CopyFacade.CopyTo`/`DeleteEverywhereFacade.DeleteFrom`
  client-side `Promise.allSettled` fan-out with a server-side `Task.WhenAll` fan-out over a
  caller-supplied target list, calling `ItemMutationService`'s existing single-item methods
  in-process (no GitHub-calling logic duplicated). Both are the one deliberate exception to this
  backend's "let `Octokit.ApiException` propagate uncaught" rule: every other write here treats a
  single-item mutation's failure as the whole request's failure, but a batch is different by
  definition — one target being locked/forbidden must not fail the other N-1 targets, so each
  target's `Octokit.ApiException` is caught and reported individually per-target rather than
  5xx-ing the whole batch; a non-`ApiException` still isn't caught and still 500s via the global
  fallthrough. Both are registered `AddScoped`, not `AddSingleton` — unlike
  `WorkflowRunCleanupService` above, no state needs to survive between requests, since
  `Task.WhenAll` fanning out within one request/one DI scope is sufficient.
  `SyncAllVariablesService` (a later, non-phase-numbered addition, `AddScoped`) is the "Sync all"
  bulk action's orchestration — `Task.WhenAll` over a caller-supplied target list, calling
  `ItemMutationService.SyncCompositeVariableIfStaleAsync` per target in-process, the same
  "thin orchestration Service over existing single-item primitives" shape as `CopyService`/
  `DeleteEverywhereService` above, no resolution logic of its own. One deliberate structural
  deviation from that shared precedent: `CopyService`/`DeleteEverywhereService` only catch
  `Octokit.ApiException` per-target, but `SyncAllVariablesService` also catches
  `CompositeCircularReferenceException`/`CompositeFormulaNotFoundException` per-target — unlike
  Copy/Delete-everywhere where every target is the same simple write, those two domain exceptions
  are routine, expected per-item outcomes here (a formula gone circular after a sibling changed, or
  a target whose manifest entry no longer exists), not something that should abort the whole batch.
  `EnvironmentVariableCopyService` (also a post-migration addition, `AddScoped` like `CopyService`/
  `DeleteEverywhereService` above) copies every variable from one environment into another — a
  **sibling** to `CopyService`, not an extension of it, even though both are batch operations on the
  Ledger vertical: `CopyService`'s shape is one item -> N targets, always-overwrite; this Service's
  shape is N variables -> one target, skip-if-exists, with a per-item value transform (a
  case-sensitive, ordinal substring replace of the source environment's name with the destination's)
  — different enough that folding it into `CopyService` would mean branching that service's
  single-target/always-overwrite logic around an incompatible second shape rather than reusing it.
  It's also the environment-scoped analog of `EnvironmentRenameService`'s outcome-reporting
  philosophy: listing the source environment's variables is the one step allowed to fail as a soft,
  reported failure (`CopyEnvironmentVariablesResponse.ListSourceError`, still `200 OK`) rather than a
  5xx, mirroring `EnvironmentRenameService`'s `ListVariablesError` precedent exactly; every
  subsequent per-variable create is isolated (one variable's `Octokit.ApiException` is added to
  `Failures` and never aborts the batch), the same per-item isolation `CopyService`/
  `EnvironmentRenameService` already use for their own per-item writes. Both source and destination
  can be cross-repo/cross-org, since nothing in `GitHub/ActionsRestClient.cs` is repo-bound — but
  both environments must already exist; there's no inline environment creation here. Calls
  `ItemMutationService.CreateVariableAsync` in-process for each copy, so the create logic itself
  isn't duplicated, matching this backend's established "extend by composing an existing Service"
  pattern.
  `LedgerExportService` (a post-migration addition, not part of the original phased rollout — see
  `docs/Architecture.md`'s note after "The ASP.NET Core migration" section) renders `GET
  /api/ledger`'s already-computed `LedgerService.GetLedgerAsync` result as a downloadable `.xlsx`
  workbook rather than duplicating the fan-out/classification logic, matching this backend's
  established "extend by composing an existing Service" pattern (`CopyService`/
  `DeleteEverywhereService` above both do the same against `ItemMutationService`). Items are grouped
  into one worksheet per level — Organization, Repository, then one sheet per environment, in the
  order they first appear in the ledger response, not alphabetically — and a level with zero items
  gets no sheet at all, mirroring `Ledger.component.ts`'s own `GroupItems` behavior on the live
  screen. Every secret row's `Value` cell is the literal string
  `"Write-only — GitHub never returns secret values"` (`LedgerExportService.SecretValueMarker`)
  rather than blank or omitted — this app's "honest about secrets" design language (see the root
  README's Features list and `docs/Architecture.md`'s dedicated section) extended to a static file
  that has no UI copy to lean on. A variable/secret's org-level `Visibility` (all/private/selected)
  rides straight through from `LedgerItemResponse.Visibility`, already populated by
  `LedgerService`/`ItemMutationService` upstream — this Service doesn't compute it itself.
  `CreatedAt`/`UpdatedAt` are written as real Excel date cells (`XLCellValue` has no
  `DateTimeOffset` overload, so each is converted to a UTC `DateTime` first, since GitHub's
  timestamps are already UTC-sourced) with an explicit `yyyy-mm-dd hh:mm:ss` format, not
  pre-formatted strings, so a downloaded sheet stays sortable/filterable in Excel. If the ledger read
  came back with any `partialErrors`/`lockedSections`, a `Notes` sheet lists them (`Type`/`Detail`
  columns) — a downloaded file has no dismissable partial-error banner the way the live screen does,
  so this is how a missing environment sheet reads as a permissions gap instead of a silent bug.
  One edge case gets a dedicated fallback: ClosedXML's `XLWorkbook.SaveAs` throws if a workbook ends
  up with zero worksheets, which a genuinely empty-but-fully-accessible scope (no variables/secrets
  anywhere, nothing locked, nothing errored) would otherwise produce — `ExportAsync` adds one
  explanatory "No variables or secrets found in this scope." sheet in that case rather than letting
  the save throw. Uses `ClosedXML` (MIT-licensed) rather than the more commonly reached-for
  `EPPlus`: `EPPlus` moved to a commercial Polyform Noncommercial license as of its v5 release,
  which is free for noncommercial use only, whereas this project has no such restriction on how it
  or a fork of it may be used — `ClosedXML` stays MIT throughout, matching the license posture of
  every other dependency already in this `.csproj` (`Octokit`, `Sodium.Core`,
  `Swashbuckle.AspNetCore`), so it was the only real choice, not a coin flip. A later,
  non-phase-numbered addition, updated again by the composite-variable manifest redesign: the
  additive column sitting right after the existing "Value" column is now **"Formula"**, not
  "Resolved Value" — populated only for a composite variable row (`item.Formula`, from the manifest).
  The old "Resolved Value" column made sense when "Value" was the raw formula and "Resolved Value"
  was the computed literal; now that "Value" is *always* the already-resolved literal, a
  "Resolved Value" column would be near-redundant with it — the formula itself (available nowhere
  else in the exported file) is the genuinely new information worth a column now.
  `CompositeVariableResolver` (a later, non-phase-numbered addition, `AddScoped`) owns composite-
  variable *resolution* mechanics (Azure-App-Config-style `$(OtherVarName)` formulas inside a GitHub
  Actions **variable**'s value, never a secret) — kept a distinct, narrow class, not folded into
  `LedgerService`/`ItemMutationService`, the same rationale `SecretSealingService` is kept separate:
  a self-contained concern (regex-based `IsComposite`/`ExtractReferences`, recursion-stack cycle
  detection in `Resolve`, and two different ways of building a name→value lookup) that both a read
  path and a write path need without either owning it. As of the manifest-based redesign, this class
  no longer decides "is this composite" on its own — that's now `CompositeManifestService`'s
  responsibility (see below); `IsComposite` is still used, but only for live-authoring-time detection
  of what's currently typed into a value box before it's saved, not for deriving a fetched row's
  compositeness. `IsComposite`/`ExtractReferences` are `static`
  (pure regex, no GitHub calls) and mirrored by hand in `client/`'s `core/facades/LedgerSupport.ts`
  (`IsCompositeValue`/`ExtractReferences`) for the exact same reason `CopyResult`/`CopyRequest` are
  kept as separate DTOs elsewhere in this codebase — a deliberate, explicit duplication rather than a
  shared package. `Resolve(name, value, lookup)` walks `$(NAME)` references recursively (a nested
  composite reference resolves too), seeding the recursion stack with the formula's own name so a
  direct self-reference (`X = $(X)`) is caught by the exact same cycle check as any longer chain, and
  leaves an unresolved `$(NAME)` token as literal text in the result rather than blanking it — a
  broken reference stays visible in place, a confirmed product decision (see
  `docs/Architecture.md`'s composite-variables section). Two lookup builders, matching the two places
  a resolution needs to happen: `BuildLookupFromItems` (static, reuses an already-fetched in-memory
  `LedgerItemResponse` list — `LedgerService`'s read-time pass) and `BuildLookupAsync` (fresh, scoped
  `ActionsRestClient` calls at only the levels relevant to one item's own precedence chain — the
  resolve-preview endpoint, `ItemMutationService`'s pre-write validation, and `SyncCompositeVariableAsync`,
  none of which has a full ledger read handy). Both enforce GitHub Actions' real override precedence —
  environment > repository > organization — the same way: adding levels broadest-first and letting a
  narrower-scope entry of the same name overwrite it. Neither builder ever looks outside the single
  org/repo passed in, so no cross-repo/cross-org reference is possible.
  `CompositeManifestService` (added by the manifest-based redesign, `AddScoped`) owns the hidden
  `__GHVM_COMPOSITE_MANIFEST__` manifest variable's read/write mechanics — one per scope
  (organization/each repository/each environment), a `{ variableName: formula }` JSON map, never
  shown as a normal ledger row. `ParseManifest` parses an already-fetched `ListVariablesAsync` result
  with no GitHub call of its own (used by `LedgerService`'s read path, which already fetches this
  exact list for every scope job) — missing or unparseable content degrades to an empty map, which is
  also how a pre-existing old-model row (a plain `$(...)`-literal value with no manifest entry) now
  reads as an ordinary plain variable, with no migration flow needed. `GetManifestAsync` is the fresh-
  read variant for write-path callers that don't already have the scope's variable list in hand.
  `ApplyAsync` is the sole write primitive: reads the current manifest, runs a caller-supplied
  `Action<Dictionary<string, string>>` mutation against a copy, and issues a GitHub write only if the
  map actually changed — an unnecessary write (e.g. removing a key that was never present) is a
  deliberate no-op, not a wasted API call. Talks to `ActionsRestClient` directly rather than routing
  through `ItemMutationService` — `ItemMutationService` is this service's own consumer, so routing
  back through it would be circular. Kept SRP-separate from `CompositeVariableResolver`: that class
  resolves a formula against a lookup; this class owns the manifest blob's read/write mechanics only.
- `GitHub/` — Octokit-based outbound client wrapper(s). `GitHubClientFactory` builds an
  Octokit `IGitHubClient` credentialed with the current request's bearer token — the shared entry
  point every migration vertical's GitHub-calling code goes through. Its construction logic now
  lives in `OctokitClientBuilder.BuildFor(token)` (Phase 5), a small static helper
  `GitHubClientFactory` delegates to — extracted so `WorkflowRunCleanupService`'s Singleton
  background job (which can't inject `GitHubClientFactory` itself, see `Services/` above) can build
  its own one-off client from a plain token string without duplicating the two-line construction. `GitHubOAuthRelayClient` is a
  raw typed `HttpClient` (not Octokit) relaying the two `github.com/login/device/...` device-flow
  calls — Octokit.NET's `OAuthClient` only implements the classic web flow, which needs a client
  secret the device flow doesn't have. `ActionsRestClient` (Phase 3a) is the first
  non-Octokit-typed-client wrapper: Octokit.NET 14.0.0 has no typed client for Actions
  Variables/Secrets/Environments (confirmed against Octokit's source and its open feature
  requests), so it talks to those REST paths directly through Octokit's low-level
  `Connection.Get<T>`/`Post<T>`/`Put`/`Patch<T>`/`Delete` methods instead — these still throw
  `Octokit.ApiException` on non-2xx, so `PermissionErrorExceptionHandler` still applies uncaught,
  same as every typed Octokit call. Its URL-building is a direct port of
  `client/src/app/core/gateways/GithubPathBuilder.ts`'s level-branching, and its pagination is a
  direct port of `GithubPagination.ts`'s total-count-driven loop. Phase 3b adds its
  `GetPublicKeyAsync`/`PutSecretAsync`/`DeleteSecretAsync` "secret writes" section, mirroring the
  "variable writes" section's shape — `PutSecretAsync`'s request body (visibility fields
  org-level-only, defaulting to "all", `selected_repository_ids` only when "selected") is a direct
  port of the old `client/src/app/core/gateways/GithubSecretsGateway.service.ts`'s body-building.
  Phase 3c adds its "environment writes" section (`CreateEnvironmentAsync`/`DeleteEnvironmentAsync`)
  — a direct port of the old `client/src/app/core/gateways/GithubEnvironmentsGateway.service.ts`'s
  `CreateEnvironment`/`DeleteEnvironment`; GitHub's environment PUT is create-or-update with no
  request body needed, unlike variables/secrets.
  `RawActionsModels.cs` holds the DTOs `ActionsRestClient` deserializes into — **plain mutable
  classes, not `sealed record`s**, because Octokit's `SimpleJsonSerializer` needs settable
  properties. This is a deliberate, documented, one-off exception to this project's `sealed record`
  DTO convention, scoped to that one file: Octokit's serializer auto-maps plain PascalCase
  properties to GitHub's snake_case JSON the same way it does for Octokit's own typed models (e.g.
  `Repository.CreatedAt` <-> `created_at`) — confirmed empirically via a spike test
  (`GitHub/RawActionsModelsSpikeTests.cs`) before the rest of the DTOs were built out, with zero
  `[Parameter(Key = "...")]` attributes needed.
- `Contracts/` — request/response DTOs exposed to `client/`, distinct from GitHub's raw shapes.
  `AuthContracts.cs` covers the Auth vertical, `ScopesContracts.cs` covers the Scopes vertical,
  `LedgerContracts.cs` covers the Ledger vertical (`Level`/`Kind` stay plain strings, not C#
  enums, to match `client/`'s TS string unions on the wire without extra converter config).
  `LedgerContracts.cs` gains `PutSecretRequest`/`RenameSecretRequest`/`RenameSecretResponse` in
  Phase 3b — `RenameSecretResponse` (`DeleteSucceeded`/`DeleteError`) is the wire shape for a
  secret rename's reported partial outcome. Phase 3c adds `EnvironmentResponse` (`ListEnvironmentsAsync`'s
  wire-exposed return type — moved here from a private `EnvironmentsService`-internal record, since
  `GET /api/ledger/environments` exposes it directly now, matching how `ScopesService` returns
  `Contracts/` types directly), `CreateEnvironmentRequest`, `RenameEnvironmentRequest`,
  `VariableCopyFailureResponse`, and `RenameEnvironmentResponse` (`ListVariablesError`/
  `VariablesCopied`/`VariableCopyFailures`/`OldEnvironmentDeleted`/`OldEnvironmentDeleteError` — the
  wire shape for an environment rename's reported outcome, mirroring `RenameSecretResponse`'s
  philosophy). `RunnersContracts.cs` (Phase 4) adds `RunnerResponse`/`RunnerLabelResponse`, own DTOs
  decoupled from Octokit's `Runner`/`RunnerLabel` model types, matching `ScopesService.ToRepoResponse`'s
  established precedent of never exposing an Octokit type on the wire. `WorkflowsContracts.cs`
  (Phase 5) adds `WorkflowResponse`/`WorkflowRunResponse` (own DTOs, same never-expose-Octokit-types
  precedent) plus the bulk-delete start+poll pair's wire shapes:
  `StartWorkflowRunCleanupRequest`/`StartWorkflowRunCleanupResponse` (a job id) and
  `WorkflowRunCleanupProgressResponse` (`Done`/`Total`/`Completed`/`SucceededIds`/`FailedIds`/
  `PermissionDenied` — what `GET /api/workflows/runs/cleanup/{jobId}` returns on every poll).
  Post-Phase-5, `WorkflowsContracts.cs` gained `CommitMessage` on `WorkflowRunResponse` (the run
  list's commit-subject display name — see `Services/` above) and three new records for the
  run-detail panel: `WorkflowRunJobStepResponse` (`Name`/`Number`/`Status`/`Conclusion`/`StartedAt`/
  `CompletedAt`), `WorkflowRunJobResponse` (same shape plus `Id`/`Name` and an ordered
  `IReadOnlyList<WorkflowRunJobStepResponse> Steps`), and `WorkflowRunDetailResponse` (the run
  itself — `Id`/`Name`/`DisplayTitle`/`CommitMessage`/`Status`/`Conclusion`/`Event`/`RunNumber`/
  `RunAttempt`/`HeadBranch`/`HeadSha`/`ActorLogin`/`ActorAvatarUrl`/timestamps/`HtmlUrl` — plus
  `IReadOnlyList<WorkflowRunJobResponse> Jobs`), what `GET /api/workflows/runs/{runId}` returns.
  `LedgerContracts.cs` gains a batch-operations section in Phase 6: `LedgerScopeTargetRequest`/
  `LedgerScopeTargetResponse` (a single copy/delete-everywhere target, request and response shapes
  kept separate rather than reused, matching this file's existing request/response DTO separation
  elsewhere), `CopyRequest`/`CopyTargetResult`/`CopyResponse`, and
  `DeleteEverywhereRequest`/`DeleteEverywhereTargetResult`/`DeleteEverywhereResponse` — each
  `*TargetResult` reports `Ok`/`Message` per target, the wire shape for
  `CopyService`/`DeleteEverywhereService`'s per-target-isolated outcome reporting (see `Services/`
  above). Phase 6 also removes `UpsertVariableRequest`: it backed the now-deleted `PUT
  /api/ledger/variables` endpoint, whose only caller was `client/`'s old `CopyFacade.CopyTo`
  variable branch — once that branch calls `POST /api/ledger/copy` instead (a separate frontend
  dispatch; unverified from this backend-only dispatch, but the reasoning holds either way), the
  endpoint had zero remaining callers. The underlying method,
  `ItemMutationService.UpsertVariableAsync`, is unaffected and stays — `EnvironmentRenameService`
  and the new `CopyService` both still call it in-process.
  A later, non-phase-numbered addition to `LedgerContracts.cs`: `CopyEnvironmentVariablesRequest`
  (`SourceOrg`/`SourceRepo`/`SourceEnv`/`DestOrg`/`DestRepo`/`DestEnv`, all required) and
  `CopyEnvironmentVariablesResponse` (`ListSourceError`/`Copied`/`Skipped`/`Failures`) — the wire
  shapes for `POST /api/ledger/environments/copy-variables`, deliberately their own shape rather
  than reusing `CopyRequest`/`CopyResponse` (see `Services/EnvironmentVariableCopyService` above for
  why the two operations aren't the same shape).
  Another later, non-phase-numbered addition to `LedgerContracts.cs`: composite-variable support
  (see `Services/CompositeVariableResolver`/`Services/CompositeManifestService` above), since updated
  again by that feature's own manifest-based redesign. `LedgerItemResponse` gains `Formula` (the raw
  `$(NAME)` formula text, populated only when the item's name is a key in its own scope's manifest —
  this is now the sole "is this composite" signal) alongside `ResolvedValue`/`UnresolvedReferences`
  (`ResolvedValue` repurposed as a staleness signal, recomputed fresh every read against current
  sibling values — `Value != ResolvedValue` means a dependency changed since this item's last
  write/sync) — all three optional, `null`/empty for every plain value and every secret.
  `ResolveVariableRequest`/`ResolveVariableResponse` are the wire shapes for the preview-only `POST
  /api/ledger/variables/resolve` route — `ResolveVariableResponse`
  (`ResolvedValue`/`UnresolvedReferences`/`Circular`/`CircularError`) is deliberately its own shape
  rather than reusing `LedgerItemResponse`, since a preview has no item identity (name/level/scope)
  of its own to carry. `UpsertVariableResponse` (`ManifestSynced`/`ManifestSyncError`) is what
  `POST`/`PATCH /api/ledger/variables` now return instead of a bare `200` — mirrors the existing
  `RenameSecretResponse` partial-outcome precedent; for the overwhelming majority of writes (plain,
  non-composite values with no prior formula) this is always `(true, null)`.
  `SyncVariableRequest`/`SyncVariableResponse` are the wire shapes for `POST
  /api/ledger/variables/sync` (the manual Sync action, replacing the old "flatten to literal" 1:1) —
  `SyncVariableRequest` deliberately carries no formula/value of its own (`Org`/`Repo`/`Env`/`Level`/
  `Name` only), since the server looks the formula up from the manifest it already owns rather than
  trusting a client-supplied one; `SyncVariableResponse` returns the freshly-resolved
  `ResolvedValue`/`UnresolvedReferences`. A later, non-phase-numbered addition, the bulk complement:
  `SyncAllVariablesRequest` (one field, `Targets`, an `IReadOnlyList<SyncVariableRequest>` — reusing
  that request shape per-target rather than inventing a new one, the same reuse precedent
  `LedgerScopeTargetRequest` set for `CopyRequest`/`DeleteEverywhereRequest`) is the wire shape for
  `POST /api/ledger/variables/sync-all`. `SyncAllTargetResult` (`Target`/`Ok`/`Synced`/
  `ResolvedValue`/`Message`) reports each target's outcome independently — `Ok`/`Synced` are
  independent flags: `Ok:true,Synced:true` means resolved fresh and the value changed, so it was
  written; `Ok:true,Synced:false` means resolved fresh but already current, so the write was skipped;
  `Ok:false` means a circular formula, a missing manifest entry, or a GitHub API error, with
  `Message` set in that case. `SyncAllVariablesResponse` wraps a list of these.

## Stateless by design

`api/` holds no database and no session store. The user's own GitHub token travels from `client/`
as an `Authorization: Bearer` header on every request, gets read per-request by
`Auth/IBearerTokenAccessor`, and is forwarded straight through to GitHub via Octokit
(`GitHub/GitHubClientFactory`) — never persisted here in any form.

## Local dev

Plain HTTP on `http://localhost:5080`, no HTTPS redirection/dev-cert setup — deliberately mirrors a
plain-HTTP-only local setup rather than the ASP.NET Core template's default HTTPS profile, since
this backend runs behind the same trusted local-dev assumptions the rest of this app always has.
See `Properties/launchSettings.json` (single `http` profile) and `Program.cs` (no
`UseHttpsRedirection()`). CORS defaults to `http://localhost:4200` (the live app) and
`http://localhost:5173` (the archived React app), overridable via the `WEB_ORIGIN` env var.

Interactive API docs are available at `/swagger` (Swagger UI) and `/swagger/v1/swagger.json` (the
raw OpenAPI document), via `Swashbuckle.AspNetCore`. Both are gated behind
`app.Environment.IsDevelopment()` in `Program.cs` — this backend has no `[Authorize]`/authentication
middleware anywhere (every handler manually checks `IBearerTokenAccessor.GetToken()` instead), so
there's no other layer protecting an interactive API browser from being reachable in a real
deployment; it simply doesn't exist outside local dev. Routes are grouped by the same vertical tags
this file uses — `Auth`/`Scopes`/`Ledger`/`Runners`/`Workflows` — via `.WithTags(...)` on each route,
and each carries a `.WithName(...)`/`.WithSummary(...)`. Response schemas needed an explicit
`.Produces<T>(...)` per route rather than relying on Swashbuckle's usual reflection-based inference:
every handler in this codebase returns the opaque `IResult`/`Task<IResult>` (via `Results.Ok(...)`/
`Results.Json(...)`), which erases the actual return type, so a new route that skips `.Produces<T>`
will build and run fine but silently show "no response body documented" in Swagger UI — worth
remembering when adding one. The Swagger UI's padlock icon uses a single global bearer security
requirement (`AddSecurityRequirement` in `Program.cs`, since there's no `[Authorize]` convention to
hang a per-route requirement off), with one known imprecision: it's applied even to the 3 Auth relay
routes (`GET /github/client-id`, `POST /github/device-code`, `POST /github/device-token`) that don't
actually need a token — harmless, Swagger UI just prepopulates an `Authorization` header those
handlers ignore.

## Testing

`tests/GithubVariablesManager.Api.Tests/` uses `WebApplicationFactory<Program>` for endpoint-level
tests (see `HealthEndpointTests.cs`, `Endpoints/AuthEndpointsTests.cs`) and plain xUnit unit tests
for everything else (see `PermissionErrorClassifierTests.cs`,
`HttpContextBearerTokenAccessorTests.cs`, `Services/DeviceFlowServiceTests.cs`,
`Services/ViewerServiceTests.cs`). `FakeHttpMessageHandler.cs` is a shared test double standing in
for the network — it returns canned JSON/status responses in order and is wired into a typed
`HttpClient` (`GitHubOAuthRelayClient`) or an Octokit `Connection` (via
`Octokit.Internal.HttpClientAdapter`) alike, mirroring
`client/src/app/core/testing/TestDoubles.ts`'s fake-gateway convention as closely as C# allows.
`WorkflowRunCleanupService`'s per-chunk `Task.WhenAll` (Phase 5) is the first genuinely concurrent
caller this double sees — every earlier vertical only ever issued sequential requests — so
`FakeHttpMessageHandler` guards its queue/request-log mutations with an explicit `lock`.
`Services/WorkflowRunCleanupServiceTests.cs`/`Endpoints/WorkflowsEndpointsTests.cs` poll the
service's/endpoint's progress in a short bounded retry loop (the actual deletion runs on a
detached background task racing the test thread) rather than asserting on a fixed delay.
