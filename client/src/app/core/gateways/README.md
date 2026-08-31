# core/gateways

One narrow interface per GitHub resource, plus an `HttpClient`-backed implementation of each,
registered against an `InjectionToken` in `App.config.ts`. This is the seam that makes a future
ASP.NET Core backend swap a one-place change: swap the provider registration, not the callers —
see `docs/Architecture.md`'s "Gateway/Adapter" pattern entry for the full rationale.

## Contents

- `IVariablesGateway.ts` / `BackendVariablesGateway.service.ts` — talks to the `api/` ASP.NET Core
  backend's Ledger vertical (`Endpoints/LedgerEndpoints.cs`), not `api.github.com` (Phase 3a).
  Covers only the mutations now (`CreateVariable`, `UpdateVariable`, `DeleteVariable`) —
  `ListVariables` was dropped once `LedgerFacade` moved to `ILedgerGateway`'s merged read.
  `UpsertVariable` (create-or-update-by-name, no rename) was dropped in Phase 6: it existed only
  for `CopyFacade.CopyTo`'s old client-side variable branch, which now calls `ILedgerGateway.Copy`
  instead — its backend route (`PUT /api/ledger/variables`) is gone too.
- `ILedgerGateway.ts` / `BackendLedgerGateway.service.ts` — talks to the `api/` ASP.NET Core
  backend's Ledger vertical (`Endpoints/LedgerEndpoints.cs`). Started as purely the merged read
  (`GET /api/ledger`), which does the variables + secrets + environment fan-out and locked-section
  classification server-side (`Services/LedgerService.cs`) that `LedgerFacade`/
  `LedgerSupport.RunLedgerJobs` used to assemble client-side. Reuses `LedgerResult`/
  `LedgerPartialError`/`LedgerLockedSection` from `core/facades/LedgerSupport.ts` for the response
  shape instead of a new duplicate type. As of Phase 6 it also covers `Copy`/`DeleteEverywhere`
  (`POST /api/ledger/copy`/`delete-everywhere`) — the same precedent `IWorkflowsGateway` already
  set of a Gateway growing from reads-only to include a bulk op belonging to the same vertical.
  Reuses `CopyTarget`/`CopyResult`/`DeleteEverywhereTarget`/`DeleteEverywhereResult` from
  `core/facades/CopySupport.ts` for those shapes, and has a private `ToTargetRequest` mapper
  (the reverse of `ToLedgerItem`'s scope extraction) flattening a `ScopeRef` into the wire shape's
  separate `org`/`repo`/`env` fields. Also covers `ExportLedger(org, repo?)` — `GET
  /api/ledger/export`, requested with `responseType: 'blob'`/`observe: 'response'` so the response's
  headers are reachable, not just its body. Filename resolution reads the response's
  `Content-Disposition` header (`filename="..."`) but never trusts it blindly: a private
  `FilenameFrom` falls back to recomputing the same `{org}[-repo]-variables-secrets-{date}.xlsx`
  format `api/`'s `LedgerExportService.BuildFilename` builds server-side, so a header-parsing edge
  case (a proxy stripping it, an unexpected quoting style) never blocks the actual download — only
  the suggested filename degrades. A later, non-phase-numbered addition:
  `CopyEnvironmentVariables(source, dest)` — `POST /api/ledger/environments/copy-variables`, both
  `source`/`dest` always fully environment-scoped `ScopeRef`s (`org`+`repo`+`env` all set), not
  restricted to the currently-open org/repo (nothing in `api/`'s `ActionsRestClient` is repo-bound).
  Returns `EnvironmentVariableCopyResult` (from `core/facades/CopySupport.ts`) — deliberately a
  separate type from `CopyResult` above, since this is a different operation shape (N variables into
  one target, skip-if-exists) than `Copy` (one item into N targets, always-overwrite); see
  `Services/EnvironmentVariableCopyService.cs`'s doc comment / `docs/Architecture.md` for why it's a
  sibling to `CopyService`, not an extension. A later, non-phase-numbered addition:
  `ResolveVariable(scope, level, name, value)` — `POST /api/ledger/variables/resolve`, preview-only,
  never writes anything (composite-variable support — Azure-App-Config-style `$(OtherVarName)`
  formulas, variables only). Returns `ResolveVariableResult` (`resolvedValue`/
  `unresolvedReferences`/`circular`/`circularError`), also declared in this file rather than
  `core/facades/LedgerSupport.ts`, since it's not part of the merged-read `LedgerResult` shape those
  other reused types are. `GetLedger`'s own response also carries new `resolvedValue`/
  `unresolvedReferences` fields per item now (mapped straight through in `ToLedgerItem`, see
  `core/Types.ts`'s `LedgerItem` for the client-facing shape) — populated server-side by
  `Services/LedgerService.cs`'s post-fan-out resolution pass, not computed here.
- `ISecretsGateway.ts` / `BackendSecretsGateway.service.ts` — talks to the `api/` ASP.NET Core
  backend's Ledger vertical (`Endpoints/LedgerEndpoints.cs`), not `api.github.com` (Phase 3b).
  Sends a secret's plaintext value directly — sealing (public-key fetch + libsodium sealed-box
  encryption) happens server-side now (`api/Services/SecretSealingService.cs`), replacing the old
  `GithubSecretsGateway.service.ts`/`SecretSealingService.ts` pair entirely. `ListSecrets`/
  `GetPublicKey` were dropped the same way `IVariablesGateway` dropped `ListVariables` in Phase 3a
  (reads go through `ILedgerGateway`'s merged read); `RenameSecret` replaced the old two-call
  `PutSecret`-then-`DeleteSecret` sequence with one backend call that reports whether the delete
  step actually succeeded (`RenameSecretResult.deleteSucceeded`) — see
  `core/facades/README.md`'s `ItemMutationsFacade.ts` entry for how a `false` result is handled.
- `IEnvironmentsGateway.ts` / `BackendEnvironmentsGateway.service.ts` — talks to the `api/` ASP.NET
  Core backend's Ledger vertical (`Endpoints/LedgerEndpoints.cs`), not `api.github.com` (Phase 3c).
  `RenameEnvironment` replaces the old client-side create-then-copy-then-delete sequence
  (`RenameEnvironmentDialogComponent` used to drive `EnvironmentsFacade.createEnvironment` +
  `CopyFacade.CopyTo` + `EnvironmentsFacade.deleteEnvironment` itself) with one backend call that
  reports exactly what happened (`RenameEnvironmentResult`'s `listVariablesError`/
  `variableCopyFailures`/`oldEnvironmentDeleted`/`oldEnvironmentDeleteError`) — see
  `core/facades/README.md`'s `EnvironmentsFacade.ts` entry for how the result is handled.
- `IRunnersGateway.ts` / `BackendRunnersGateway.service.ts` — talks to the `api/` ASP.NET Core
  backend's Runners vertical (`Endpoints/RunnersEndpoints.cs`), not `api.github.com` (Phase 4).
  Collapsed to one method, `ListRunners(org, repo?)` — the org-vs-repo branching that used to live
  in `RunnersFacade` (calling either `ListRepoRunners`/`ListOrgRunners`) moved server-side into
  `api/Services/RunnersService.cs`. The one Backend gateway so far with its own local
  `HttpErrorResponse` -> `GitHubApiError` converter (`ToBackendRunnersError`, inlined in the file
  rather than extracted — rule of three not yet hit): it reads `locked` straight off the backend's
  parsed `{ locked, status, message }` response body rather than recomputing it from `status`, so
  `RunnersPanel.component.ts`'s `noAccess` computed reflects the backend's actual classification.
- `IWorkflowsGateway.ts` / `BackendWorkflowsGateway.service.ts` — talks to the `api/` ASP.NET Core
  backend's Workflows vertical (`Endpoints/WorkflowsEndpoints.cs`), not `api.github.com` (Phase 5).
  `StartRunCleanup`/`PollRunCleanup` are a start+poll pair replacing the old N-calls-per-delete
  shape: bulk-deleting a workflow's runs used to be `WorkflowsFacade`'s own client-side chunking
  (`DELETE_CHUNK_SIZE`, one `DeleteWorkflowRun` call per run, `Promise.allSettled` per chunk); now a
  single `POST /api/workflows/runs/cleanup` kicks off the chunked fan-out server-side
  (`api/Services/WorkflowRunCleanupService.cs`) and `GET
  /api/workflows/runs/cleanup/{jobId}` is polled for progress. `GetWorkflowRunDetail(owner, repo,
  runId)` (`GET /api/workflows/runs/{runId}`) and `RerunWorkflowRun(owner, repo, runId)` (`POST
  /api/workflows/runs/rerun`), added for the run-detail panel/rerun feature, round out the vertical:
  the detail call returns a fully-paginated jobs+steps tree server-side
  (`Services/WorkflowsService.GetWorkflowRunDetailAsync`), same "no raw-to-domain mapping needed"
  precedent as the rest of this Gateway. Has its own local
  `HttpErrorResponse` -> `GitHubApiError` conversion (`ToBackendWorkflowsError`), mirroring
  `BackendRunnersGateway`'s exact pattern: reads `locked` straight off the backend's parsed `{
  locked, status, message }` response body rather than recomputing it from `status`, so
  `features/workflows/WorkflowRunMessages.ts`'s `PermissionAwareMessage` (moved out of
  `WorkflowsView.component.ts`, its original home, once the run-detail panel needed it too without a
  circular import) checks `err.locked` instead of `err.status === 403` — the last of the four
  originally-duplicated permission-classification sites (see `docs/Architecture.md`).
- `IScopesGateway.ts` / `BackendScopesGateway.service.ts` — talks to the `api/` ASP.NET Core
  backend's Scopes vertical (`Endpoints/ScopesEndpoints.cs`), injecting `HttpClient` directly, with
  its base URL from `environments/environment.ts`'s `backendApiBaseUrl`. Unlike
  `BackendOAuthGateway`, it needs no `AUTH_TOKEN_OVERRIDE` — every `IScopesGateway` call runs with
  an active session, so `AuthInterceptor`'s ambient `Authorization: Bearer` attachment covers it
  automatically.
- `IOAuthGateway.ts` / `BackendOAuthGateway.service.ts` — talks to the `api/` ASP.NET Core
  backend's Auth vertical (`Endpoints/AuthEndpoints.cs`), injecting `HttpClient` directly, with its
  base URL from `environments/environment.ts`'s `backendApiBaseUrl`. It does reuse
  `AuthTokenOverride.ts`'s `AUTH_TOKEN_OVERRIDE` context for `GetViewer`'s pre-session token
  lookup, since that mechanism is generic to any Gateway, not GitHub-specific.
- `GitHubApiError.ts` — as of Phase 4, its constructor takes an optional third `locked?: boolean`
  param, defaulting to `status === 403 || status === 404` (the check every pre-existing call site
  already computed inline) when omitted. `BackendRunnersGateway`/`BackendWorkflowsGateway` pass it
  explicitly instead, reading `locked` off their backend's response body.
- `AuthTokenOverride.ts` — `AUTH_TOKEN_OVERRIDE`/`AuthTokenOverrideContext`, the one exception to
  ambient credential attachment: the one call that has to run before a session exists
  (`AuthService.ConnectWithToken`'s viewer lookup, to validate a token that hasn't been stored yet)
  uses it to override the token for a single request. Owned at this layer, not by
  `core/interceptors/AuthInterceptor.ts`, so Gateways depend downward on this token only — never
  sideways on `core/interceptors`.
- `GithubPathBuilder.ts` — now just exports `ItemId`, a shared cache-key builder. Its
  `VariablesPath`/`SecretsPath` URL-building functions were removed as dead code once every Gateway
  moved to calling `api/` instead of building GitHub REST URLs itself.

Facades/Components inject the `InjectionToken`s exported from the `I*Gateway.ts` files — never a
concrete `Backend*Gateway` class directly.
