# features/dashboard

## Contents

- **`DashboardShell.component.ts`/`.html`** — the screen shell. Reads the route params via
  `toSignal(this.route.paramMap, { requireSync: true })` and derives the active
  `scope`/`breadcrumb` from them. Wires `EnvironmentsFacade.EnvironmentsQuery`,
  `ScopesFacade.IsOrgAccountQuery`, and `LedgerFacade.LedgerQuery`. Owns all modal state (which
  editor/copy/delete/rename dialog is open) as component signals. Renders `ScopeSidebarComponent` +
  `RunnersPanelComponent` in the fixed sidebar, and a List/Compare toggle in the main area.
  `<main>` renders `app-ledger` (`features/ledger/`) or `app-compare-view` (`features/compare/`)
  depending on `viewMode()`. Every ledger-row action is fully real: delete → `ItemMutationsFacade`
  + `ConfirmDialogComponent`; add/edit → `editorState` signal rendering `ItemEditorPanelComponent`
  (`features/item-editor/`); copy → `copyTarget` signal rendering `CopyItemDialogComponent`
  (`features/ledger/CopyItemDialog.component.ts`). `CompareViewComponent` owns its own equivalent
  dialog state internally rather than routing through this shell — see
  `features/compare/README.md` for why.
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
  per-runner status (online/busy/offline).
- **`RenameEnvironmentDialog.component.ts`/`.html`** — GitHub has no rename-environment endpoint,
  so this creates the new environment, copies every environment-level variable's value across, then
  deletes the old environment — unless it still has secrets (which can't be read back to copy), in
  which case deletion is skipped unless the user explicitly checks "delete anyway". The `newName`
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
