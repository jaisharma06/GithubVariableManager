# features/dashboard

## Contents

- **`DashboardShell.component.ts`/`.html`** — the screen shell. Reads the route params via
  `toSignal(this.route.paramMap, { requireSync: true })` and derives the active
  `scope`/`breadcrumb` from them. Wires `EnvironmentsFacade.EnvironmentsQuery`,
  `ScopesFacade.IsOrgAccountQuery`, and `LedgerFacade.LedgerQuery`. Owns all modal state (which
  editor/copy/delete/rename dialog is open) as component signals. Renders `ScopeSidebarComponent` +
  `RunnersPanelComponent` in the fixed sidebar, and a List/Compare/Workflows toggle in the main
  area (the latter two only shown for a repo scope). `<main>` renders `app-ledger`
  (`features/ledger/`), `app-compare-view` (`features/compare/`), or `app-workflows-view`
  (`features/workflows/`) depending on `viewMode()`. Every ledger-row action is fully real: delete →
  `ItemMutationsFacade` + `ConfirmDialogComponent`; add/edit → `editorState` signal rendering
  `ItemEditorPanelComponent` (`features/item-editor/`); copy → `copyTarget` signal rendering
  `CopyItemDialogComponent` (`features/ledger/CopyItemDialog.component.ts`). `CompareViewComponent`
  and `WorkflowsViewComponent` each own their own equivalent dialog state internally rather than
  routing through this shell — see `features/compare/README.md` / `features/workflows/README.md`
  for why. An **Export** button sits in the header next to `<app-rate-limit-indicator />`, visible
  across every view (List/Compare/Workflows), not inside `LedgerComponent`'s own filter toolbar —
  export downloads the whole active scope's ledger (every accessible level, one sheet each) as an
  `.xlsx` workbook via `LedgerFacade.ExportLedger`, independent of whatever filters happen to be
  applied to the on-screen list, so it belongs at the scope level, not the filtered-view level.
  `HandleExport()` follows the same `signal`-pair loading-state pattern as the delete/rename flows
  above (`exporting`/`exportError` instead of a shared mutation's `isPending`/`error`, since
  `ExportLedger` is a plain method, not an `injectMutation` — see `core/facades/README.md`'s
  `LedgerFacade.ts` entry for why) and a private `TriggerDownload(blob, filename)` — an object URL +
  a temporary, immediately-clicked-and-discarded `<a download>` anchor, the first place in this
  codebase that triggers a browser file download, so there was no prior in-repo pattern to reuse.
  Two later, non-phase-numbered additions: `editorState`'s `'create'` variant gained optional
  `name`/`value` fields, populated only by `HandlePasteToSection(event)` (wired to
  `LedgerComponent`'s `(pasteToSection)` output) — it reads `VariableClipboardService`'s buffer and
  opens `ItemEditorPanelComponent`'s create flow pre-filled from it (a no-op if the buffer is empty,
  though the "Paste" affordance that triggers this is hidden in that case anyway); the plain "+ Add"
  flow (`HandleAdd`/`HandleAddToSection`) never sets these fields. And a new `envToCopy` signal
  (`string | null`) renders `CopyEnvironmentDialogComponent` when set, wired to
  `ScopeSidebarComponent`'s `(copyEnvironment)` output — the same open/close signal pattern
  `envToRename`/`RenameEnvironmentDialogComponent` already established. Two more later,
  non-phase-numbered additions, both composite-variable (`$(OtherVarName)`) support: (1)
  `deleteItemDependents` (a `computed`, `FindDependents` from `core/facades/LedgerSupport.ts` against
  the current `deleteTarget()`) warns on the existing single-item delete confirm dialog when other
  composite variables reference the item about to be removed, listing each dependent's name + scope
  so a delete doesn't silently leave a formula pointing at nothing — the dialog still lets the delete
  proceed, since an unresolved reference is a deliberately allowed, non-blocking state everywhere in
  this app (see `docs/Architecture.md`'s composite-variables section); (2) `syncTarget`/`syncError`
  back a confirm dialog for `LedgerRowComponent`'s **Sync** action (renamed from this feature's
  original "flatten to literal" — same trigger point, but now a routine, non-destructive recovery
  action rather than a one-way escape hatch, since the composite-variable manifest redesign means a
  variable's formula survives every sync; see `features/ledger/README.md`'s
  `LedgerRow.component.ts`/`.html` entry and `docs/Architecture.md`'s composite-variables section for
  the full design). `HandleConfirmSyncItem` calls the **new** `LedgerFacade.syncVariable` mutation
  (`POST /api/ledger/variables/sync`) — unlike the old flatten action, this is a dedicated backend
  call, not a reuse of `ItemMutationsFacade.updateVariable`: the server re-reads the formula from its
  own scope's manifest and recomputes it, rather than the client needing to already know/send a
  resolved value. `syncPending` is `ledgerFacade.syncVariable.isPending`. The confirm dialog's copy
  no longer warns the action "can't be recovered" — it says the formula stays saved and can be synced
  again anytime, since that's now true.
  A later, non-phase-numbered addition, the bulk complement to that per-row Sync: `syncAllOpen`/
  `syncAllResult`/`syncAllError` back a two-step flow (confirm, then results) for `LedgerComponent`'s
  global `(syncAll)` output (see `features/ledger/README.md`'s `Ledger.component.ts`/`.html` entry for
  `hasComposites`/when the button is shown). `syncAllTargets` is a `computed` over
  `LedgerSupport.FindComposites(this.items())` — the client-computed target list, never
  server-enumerated. `HandleSyncAll` opens the confirm dialog (`ConfirmDialogComponent`, the same
  routine, non-destructive brand-hover tone as the single-item Sync dialog, not a danger tone);
  `HandleConfirmSyncAll` calls `LedgerFacade.syncAllVariables.mutateAsync(this.syncAllTargets())`
  (`POST /api/ledger/variables/sync-all`) and keeps `syncAllOpen` true throughout so the dialog
  doesn't flash closed between the confirm and results steps. `syncAllPending` is
  `ledgerFacade.syncAllVariables.isPending`. The results step shows **three** outcome buckets —
  `syncAllSynced` (`ok && synced`), `syncAllAlreadyCurrent` (`ok && !synced`), and `syncAllFailed`
  (`!ok`) — reusing `CopyEnvironmentDialog.component.html`'s existing bucket styling below: an
  `border-ok/30`/`text-ok` success treatment for synced, a neutral `bg-panel-raised` card for
  already-up-to-date (substituting where this app's palette has no `ok-dim` token), and the existing
  `border-danger/30 bg-danger-dim` failure-banner language for failed, each listing the affected
  variable names (`SyncAllNames`).
- **`ScopeSidebar.component.ts`/`.html`** — org/repo header, environment list with per-environment
  rename/delete affordances, "+ New environment" inline form. Injects `EnvironmentsFacade` directly
  (not solely via `output()`) for the create-environment flow — documented in a comment on the
  class: an `output()` can't hand the child form back a `Promise` to `await`/`catch`, which the
  inline form needs to show its own validation error without the parent round-tripping it back
  down as an `@Input()`. Exports `ScopeNavigateEvent` (`{ level, env? }`) for the parent to react to
  sidebar navigation. A later, non-phase-numbered addition: a `copyEnvironment` output (`string`, the
  environment's name), next to the existing rename/delete environment icon actions, wired by
  `DashboardShellComponent` to its `envToCopy` signal.
- **`CopyEnvironmentDialog.component.ts`/`.html`** — a later, non-phase-numbered addition. Copies
  every variable from one environment (`sourceEnv` input, fixed for the dialog's lifetime) into a
  destination environment the user picks — an org/repo search (`ScopesFacade.MyOrgsQuery`/
  `MyReposQuery`/`OrgReposQuery`, the same search pattern `CrossRepoTargetPickerComponent` uses)
  followed by an environment `<select>` (`EnvironmentsFacade.EnvironmentsQuery`). Deliberately its
  own lightweight picker rather than a reuse of `features/ledger/CrossRepoTargetPicker.component.ts`
  — that component is hard-coupled to a single `LedgerItem` plus secret-visibility fields this
  variables-only, one-destination feature doesn't need, and it supports organization-/repository-
  level targets this feature never offers (copying variables between *environments* is the whole
  point, so it always requires a repo before showing anything further to pick). All business logic
  (listing, skip-if-exists, the substring value transform, per-variable failure isolation) lives
  server-side in `api/Services/EnvironmentVariableCopyService.cs` (see `docs/Architecture.md` for why
  it's a sibling to `CopyService`, not an extension) — this component only collects the destination
  and renders whatever outcome the backend reports (`EnvironmentsFacade.copyEnvironmentVariables`),
  mirroring `RenameEnvironmentDialogComponent`'s post-Phase-3c shape of one backend call with no
  client-side orchestration. The outcome view shows up to four buckets — copied (success treatment,
  `border-ok/30`/`text-ok`), a soft `listSourceError` (failure-banner language,
  `border-danger/30 bg-danger-dim`), skipped (a neutral `bg-panel-raised` card, substituting where
  this app's palette has no `ok-dim` token), and failures (the same failure-banner language as
  `listSourceError`) — the first dialog in this app to surface more than two outcome buckets at
  once.
- **`RunnersPanel.component.ts`/`.html`** — self-hosted runners for the active scope, polled every
  30s (`RunnersFacade.RunnersQuery`'s `refetchInterval`). Computes `runners`/`onlineCount`/
  `noAccess`/`errorMessage`; `RunnerState`/`RunnerDotClass`/`RunnerLabelClass`/`RunnerTitle` render
  per-runner status (online/busy/offline). As of Phase 4 (the ASP.NET Core migration's Runners
  vertical), `noAccess` reads the backend's own classification (`err instanceof GitHubApiError &&
  err.locked`) instead of computing it from `err.status === 403 || err.status === 404` itself —
  `BackendRunnersGateway.service.ts` populates `GitHubApiError.locked` straight off `api/`'s
  `{ locked, status, message }` response body. This retires the fourth and final of the four
  originally-duplicated permission-classification sites named in `docs/Architecture.md`.
- **`RenameEnvironmentDialog.component.ts`/`.html`** — GitHub has no rename-environment endpoint,
  so renaming means creating the new environment, copying every environment-level variable's value
  across, then deleting the old environment — unless it still has secrets (which can't be read back
  to copy), in which case deletion is skipped unless the user explicitly checks "delete anyway". As
  of Phase 3c this whole sequence is one `EnvironmentsFacade.renameEnvironment` call
  (`api/Services/EnvironmentRenameService.cs` does the orchestration server-side) rather than three
  client-driven mutations, so the dialog dropped its `CopyFacade` dependency, its `environments`
  input (the "already in use" duplicate check moved server-side), and its three-phase
  `step: 'idle'|'creating'|'copying'|'deleting'` signal — `submitting` is now just
  `environmentsFacade.renameEnvironment.isPending()`, and the submit button shows a single
  "Renaming…" state instead of "Creating…"/"Copying variables…"/"Cleaning up…" (a user-visible copy
  change). It still does the same cheap, static client-side format checks (non-empty/pattern/
  not-same-as-old) before calling the gateway for zero-round-trip UX; only the "already exists"
  check (needs live GitHub state) moved server-side, surfaced through the existing `catch` handler.
  If the rename fully succeeds but the old environment's cleanup step fails
  (`oldEnvironmentDeleteError`), the dialog stays open and shows that as a warning instead of
  emitting `renamed` — mirroring `ItemEditorPanelComponent`'s identical choice for a secret rename
  whose delete-old step fails, since emitting `renamed` here closes (unmounts) this dialog in
  `DashboardShellComponent`, which would make any warning set afterward invisible. The `newName`
  signal is seeded in `ngOnInit()`, not a field initializer — see the class doc comment and
  `core/testing/README.md`'s NG0950 note for why that matters under `TestBed.createComponent()` +
  `setInput()`.

## Testing notes

Every component here depends on at least one TanStack Angular Query-backed facade, so every spec
needs `ProvideTestQueryClient()`, the relevant fake gateway providers, and — critically — a seeded
fake session (`SeedFakeSession()`/`ClearFakeSession()` from `core/testing/TestDoubles.ts`), since
every query is gated on `AuthService.token()` being truthy. Query-driven assertions poll with
`core/testing/WaitFor.ts` rather than `fixture.whenStable()`; mutation-driven flows (create/rename/
delete environment) use `fakeAsync()` + repeated `tick()` calls instead, since those are directly
awaited in the component's own zone-tracked code. See `core/testing/README.md` for the full
rationale on both patterns — mixing them up (e.g. using `whenStable()` for a query) is the single
most common way a spec in this folder silently gives a false-positive "pass" instead of actually
exercising the resolved data.
