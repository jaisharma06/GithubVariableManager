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
  for why.
- **`ScopeSidebar.component.ts`/`.html`** — org/repo header, environment list with per-environment
  rename/delete affordances, "+ New environment" inline form. Injects `EnvironmentsFacade` directly
  (not solely via `output()`) for the create-environment flow — documented in a comment on the
  class: an `output()` can't hand the child form back a `Promise` to `await`/`catch`, which the
  inline form needs to show its own validation error without the parent round-tripping it back
  down as an `@Input()`. Exports `ScopeNavigateEvent` (`{ level, env? }`) for the parent to react to
  sidebar navigation.
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
