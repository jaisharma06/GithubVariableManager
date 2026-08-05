# features/ledger

## Contents

- **`LedgerFilters.ts`** — the `LedgerFilters` type + `DEFAULT_FILTERS`. Lives here rather than
  inline in `Ledger.component.ts` because `ScopeSidebarComponent`/`DashboardShellComponent` also
  need the type for the sidebar's scope-tree navigation.
- **`SectionHeader.component.ts`/`.html`** — a group's heading (level + scope label + description)
  plus its own "+ Add" button.
- **`LedgerRow.component.ts`/`.html`** — one variable or secret row: type badge, name, masked/
  unmasked value, access column, edit/copy/delete buttons. Also exports `ROW_GRID`, the shared
  grid-column layout string, so `Ledger.component.html` can reuse the exact same columns for its
  header row and its inline locked-row markup. The locked-row variant has no interactivity and
  only ever appears inside `Ledger.component.html`, so it's inlined there directly rather than
  being its own component.
- **`FilterBar.component.ts`/`.html`** — level/kind pill filters, an environment `<select>`, and a
  name search box. Both pill groups (level, kind) are inlined in the template sharing one
  `PillClasses()` helper rather than a generic reusable "Pills" component — with only two call
  sites in one file and no reuse elsewhere, a generic component would be unjustified complexity
  (`docs/CodingStandards.md`'s "patterns must justify themselves" rule).
- **`Ledger.component.ts`/`.html`** — the whole list view: filters items, groups them by
  level/scope (`GroupItems`, a free function kept in this file rather than a Facade since it's pure
  presentation shaping of already-fetched data), renders the "Hide values" toggle, the
  partial-errors banner, loading/error/empty states, and each group via `SectionHeaderComponent` +
  `LedgerRowComponent`.
- **`CopyItemDialog.component.ts`/`.html`** — push one variable/secret's value out to a batch of
  other scopes at once. `BuildCandidates` (every other scope in the org/repo that could receive a
  copy, excluding the source, with an existing-item lookup for the overwrite/matches/not-set hint)
  is a free function, same rationale as `Ledger.component.ts`'s `GroupItems`. Submits through
  `CopyFacade.CopyTo` — this component only assembles the target list and value; the batched
  create-vs-update-per-target logic lives in the Facade.

## Wired into `DashboardShellComponent`

`app-ledger` renders in `<main>` whenever `viewMode() !== 'compare'`. `DashboardShellComponent`
owns the modal state: `(deleteItem)` → `ItemMutationsFacade` + `ConfirmDialogComponent`; `(add)`/
`(addToSection)`/`(editItem)` → `editorState` signal rendering `ItemEditorPanelComponent`
(`features/item-editor/`); `(copyItem)` → `copyTarget` signal rendering `app-copy-item-dialog`.

## Testing notes

`LedgerRowComponent`/`SectionHeaderComponent`/`FilterBarComponent` take no Facade/query
dependencies, so their specs don't need `ProvideTestQueryClient()` or a seeded session — plain
`TestBed.configureTestingModule` + `setInput()` is enough. `LedgerComponent` itself is the same:
all of its data arrives via `@Input()`, not a Facade, so it's tested the same lightweight way.
`CopyItemDialogComponent` does need the full `ProvideTestQueryClient()`/`SeedFakeSession()` set,
since `CopyFacade` sits on top of real mutations — see `features/item-editor/README.md`'s testing
notes, which apply here identically. Only `DashboardShellComponent`'s spec (which actually renders
`app-ledger` behind a real `LedgerFacade.LedgerQuery`) needs the full `WaitFor` machinery described
in `core/testing/README.md`.
