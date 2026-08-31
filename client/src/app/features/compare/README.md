# features/compare

## Contents

- **`CompareView.component.ts`/`.html`** — `CompareViewComponent`. Builds a `Column` per visible
  scope (organization/repository/each environment) and a `Row` per distinct `kind:name`, with each
  row's `cells` a `Map<columnKey, LedgerItem>`.
  - **The default column-visibility state (organization and repository columns unchecked, every
    environment column checked) is intentional** — org/repo-level values apply everywhere already,
    so the default comparison focuses on where values are most likely to actually differ
    (`deselected = signal(new Set(['organization', 'repository']))`).
  - **Owns its own dialog state**, unlike `LedgerComponent` (which bubbles add/edit/copy/delete up
    to `DashboardShellComponent` via outputs): `CompareViewComponent` renders
    `ItemEditorPanelComponent`/`CopyItemDialogComponent`/`ConfirmDialogComponent` directly for
    cell-edit, cell-copy, and row-delete-everywhere. The asymmetry is intentional, not an
    inconsistency — Ledger rows already have a natural single owner (the dashboard shell) for
    their actions, while a compare-view cell's edit target depends on compare-view-only state
    (which column/row was clicked) that has no reason to live one level up.
  - Row delete removes a name from **every** scope it's currently set in — a different operation
    from `LedgerRowComponent`'s single-scope delete, backed by `DeleteEverywhereFacade`
    (`core/facades/`) rather than `ItemMutationsFacade` directly.
  - A later, non-phase-numbered addition: `deleteRowDependents` (a `computed`, composite-variable
    (`$(OtherVarName)`) support) warns on the delete-everywhere confirm dialog when other composite
    variables reference the row's name — `FindDependents` (`core/facades/LedgerSupport.ts`) is run
    once per scope the row is being deleted from and the results deduped by item id (a wide delete
    can otherwise surface the same dependent once per matching scope). A no-op for a secret row,
    since a composite formula can never reference a secret in the first place (GitHub never returns
    one's value to substitute in).

## Wired into `DashboardShellComponent`

`app-compare-view` renders in `<main>` whenever `viewMode() === 'compare'` for a repo scope; the
List/Compare toggle lives in the header.

## Testing notes

Needs `ProvideTestQueryClient()`, fake `VARIABLES_GATEWAY`/`SECRETS_GATEWAY`/`SCOPES_GATEWAY`/
`LEDGER_GATEWAY` providers, and `SeedFakeSession()`/`ClearFakeSession()` — same requirement set as
`ItemEditorPanelComponent`/`CopyItemDialogComponent`, since this component renders both of them
plus `DeleteEverywhereFacade`'s mutation. `LEDGER_GATEWAY` (`CreateFakeLedgerGateway()`) backs the
row-delete test, which as of Phase 6 asserts one `fakeLedgerGateway.DeleteEverywhere` call with the
full target list rather than N separate `fakeVariablesGateway.DeleteVariable` calls. Delete-
everywhere assertions use `fakeAsync()` + `tick()` (a mutation flow); everything else in this
component is synchronous local state (column toggles, filters, dialog open/close), so most tests
need neither `fakeAsync` nor `WaitFor`.
