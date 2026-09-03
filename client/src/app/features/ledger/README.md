# features/ledger

## Contents

- **`LedgerFilters.ts`** — the `LedgerFilters` type + `DEFAULT_FILTERS`. Lives here rather than
  inline in `Ledger.component.ts` because `ScopeSidebarComponent`/`DashboardShellComponent` also
  need the type for the sidebar's scope-tree navigation.
- **`SectionHeader.component.ts`/`.html`** — a group's heading (level + scope label + description)
  plus its own "+ Add" button. A later, non-phase-numbered addition: a "Paste" affordance, shown
  only when `VariableClipboardService.clipboard()` is non-empty (`hasClipboard`, injected directly —
  ambient UI convenience state, the same pattern `ScopeSidebarComponent` uses for
  `EnvironmentsFacade` rather than round-tripping through outputs), emitting `pasteVariable` on
  click. Named after what's actually in the buffer in its tooltip (`clipboardName`) so it reads as
  "paste what I copied", not a generic action.
- **`LedgerRow.component.ts`/`.html`** — one variable or secret row: type badge, name, masked/
  unmasked value, access column, edit/copy/delete buttons. Also exports `ROW_GRID`, the shared
  grid-column layout string, so `Ledger.component.html` can reuse the exact same columns for its
  header row and its inline locked-row markup. The locked-row variant has no interactivity and
  only ever appears inside `Ledger.component.html`, so it's inlined there directly rather than
  being its own component. A later, non-phase-numbered addition: a "copy value" icon action,
  variable rows only (`HandleCopyValue`, a no-op for a secret row — secrets have no readable value
  to copy), calling `VariableClipboardService.CopyVariable(name, value)`. Distinct from the existing
  copy button above (which opens `CopyItemDialogComponent` to push a value out to N other scopes
  right now) — this one holds a value in the in-app clipboard buffer for a later paste anywhere,
  same-scope or not. Another later, non-phase-numbered addition: composite-variable
  (`$(OtherVarName)`) display, since updated again by that feature's own manifest-based redesign.
  `isComposite` is now driven by `item().formula` being defined — populated server-side only when
  the item's name is a key in its own scope's hidden manifest variable (`Formula`, not a regex match
  against `item().value` the way the original design derived it; `item().value` is always the real,
  already-resolved GitHub literal now, never the raw formula). The row shows the real `value` as its
  main text (it's always a working literal now, not display-only), with the raw formula
  (`item().formula`) available in a `title` tooltip on hover. `isStale` (new) is true when
  `item().resolvedValue` is defined and differs from `item().value` — a non-color pending-refresh
  glyph cue (deliberately not danger-tinted: a stale composite isn't broken, it just hasn't been
  re-synced against a dependency that changed since its last write/sync), with a tooltip spelling out
  both the stale saved value and what it would resolve to now, prompting "Click Sync to update."
  `hasUnresolvedReferences` swaps in a warning icon + the still-otherwise-resolved value when
  `item().unresolvedReferences` is non-empty — a broken reference stays visible in place rather than
  disappearing, a confirmed product decision (see `docs/Architecture.md`); this is also how a
  currently-circular formula surfaces, since `resolvedValue` is `null` in that case. A `syncItem`
  output (renamed from this feature's original `flattenItem`; `canSync` is unconditionally available
  for any composite item, including a currently-broken/circular one — no more "only if
  `resolvedValue` is defined" gate, since that gate belonged to the old flatten-to-literal design,
  where nothing existed to flatten *to* for a circular formula; clicking Sync on a circular formula
  now just surfaces the server's circular error in the confirm dialog like any other sync failure)
  fires an icon action that `DashboardShellComponent` catches to open a confirm dialog before calling
  the new `LedgerFacade.syncVariable` mutation (`POST /api/ledger/variables/sync` — see
  `features/dashboard/README.md`) — this component only emits the intent. Sync gets the same routine
  brand hover tone as "Copy to other scopes," not a danger tone, since the formula always survives a
  sync (it lives in the scope's manifest, untouched by this action) rather than being a one-way,
  irreversible flatten.
- **`FilterBar.component.ts`/`.html`** — level/kind pill filters, an environment `<select>`, and a
  name search box. Both pill groups (level, kind) are inlined in the template sharing one
  `PillClasses()` helper rather than a generic reusable "Pills" component — with only two call
  sites in one file and no reuse elsewhere, a generic component would be unjustified complexity
  (`docs/CodingStandards.md`'s "patterns must justify themselves" rule).
- **`Ledger.component.ts`/`.html`** — the whole list view: filters items, groups them by
  level/scope (`GroupItems`, a free function kept in this file rather than a Facade since it's pure
  presentation shaping of already-fetched data), renders the "Hide values" toggle, the
  partial-errors banner, loading/error/empty states, and each group via `SectionHeaderComponent` +
  `LedgerRowComponent`. Forwards each group's `SectionHeaderComponent.pasteVariable` up as its own
  `pasteToSection: { level, env? }` output, so `DashboardShellComponent` knows which section to
  pre-fill the create form for. Also bubbles `LedgerRowComponent.syncItem` straight up as its own
  `syncItem` output (composite-variable Sync action, see the `LedgerRow.component.ts`/`.html` entry
  above) — no shaping needed here, same pass-through as `editItem`/`copyItem`/`deleteItem`. A later,
  non-phase-numbered addition, the bulk complement to per-row Sync: `hasComposites` (a `computed` over
  `LedgerSupport.FindComposites(this.items())`) gates a single global "Sync all" toolbar button —
  shown only when the scope has at least one composite variable, hidden entirely (not disabled)
  otherwise; staleness plays no role in this gate, so a scope where every composite is already current
  still shows the button, producing a calm all-current outcome rather than a hidden one. A `syncAll`
  output (`void`) fires on click; `DashboardShellComponent` catches it to open the confirm dialog and
  drive `LedgerFacade.syncAllVariables` (`POST /api/ledger/variables/sync-all` — see
  `features/dashboard/README.md` and `core/facades/README.md`'s `LedgerFacade.ts` entry). This
  component only computes the client-side target list (via `FindComposites`) and emits the intent —
  it never calls the Facade itself. A later fix added a `syncAllRefreshing` input: while
  `DashboardShellComponent` re-fetches the ledger before opening the confirm dialog (see that
  component's `HandleSyncAll` entry below for why), the "Sync all" button shows "Checking for
  changes…" and is disabled, rather than immediately opening a dialog whose target list could still
  be built from a stale cached read.
- **`CopyItemDialog.component.ts`/`.html`** — push one variable/secret's value out to a batch of
  other scopes at once. `BuildCandidates` (every other scope in the org/repo that could receive a
  copy, excluding the source, with an existing-item lookup for the overwrite/matches/not-set hint)
  is a free function, same rationale as `Ledger.component.ts`'s `GroupItems`. Submits through
  `CopyFacade.CopyTo` — this component only assembles the target list and value. As of Phase 6, the
  create-vs-update-per-target decision for variables is made server-side by `CopyService`/
  `ILedgerGateway.Copy` (`Services/CopyService.cs`, itself calling the existing
  `ItemMutationService.UpsertVariableAsync` in-process); `CopyFacade`/this component don't branch
  on it — the `existing`-item lookup here is purely for the overwrite/matches/not-set UI hint, not
  for picking a mutation.
  Cross-repo/cross-org destinations (a "+ Add another repo/org…" progressive-disclosure toggle
  embedding `CrossRepoTargetPickerComponent`) are additive on top of this: `BuildCandidates` itself
  is completely untouched — it still only produces same-org/repo candidates — and the picked
  cross-repo targets live in a separate `crossRepoCandidates` signal, with `candidates` computed as
  `[...BuildCandidates(...), ...crossRepoCandidates()]`. `HandleTargetPicked` guards against picking
  the source's own scope or a duplicate of an existing candidate (`SameScope`); each cross-repo row
  gets a "×" remove control (`RemoveCrossRepoCandidate`) that same-repo rows don't. The one genuine
  new risk cross-repo introduces: `CopyFacade.CopyTo`'s `options` (secret `visibility`/
  `selectedRepositoryIds`) is one shared value for the *whole batch*, not per-target — invisible
  before, since same-repo candidates only ever include one organization-level candidate in the
  user's current org, but reachable once two different destination orgs can both be
  organization-level secret targets in the same submit. `HandleSubmit` guards this explicitly: it
  blocks a submit that would need `'selected'`-visibility for secrets at organization level in two
  *different* destination orgs at once, since there's nowhere for the second repo list to go.
- **`CrossRepoTargetPicker.component.ts`/`.html`** — the picker-only widget `CopyItemDialogComponent`
  embeds for a cross-repo/cross-org destination: org/repo search (filtered from
  `ScopesFacade.MyOrgsQuery()`/`MyReposQuery()`), level selection (organization/repository/
  environment, gated by `ScopesFacade.IsOrgAccountQuery` so org-level isn't offered for a repo owned
  by a personal account), an environment `<select>` (`EnvironmentsFacade.EnvironmentsQuery`), and —
  only for a secret being pushed to an organization-level target — a visibility/selected-repos
  picker (`ScopesFacade.OrgReposQuery`). That visibility-picker logic is deliberately duplicated from
  `ItemEditorPanelComponent` rather than extracted into a shared component — the smaller/safer choice
  for this change; a shared extraction is a legitimate follow-up, just an explicitly deferred one.
  Also independently loads the picked destination's own ledger (`LedgerFacade.LedgerQuery`, scoped to
  that org/repo, not whatever scope the dashboard currently has open) so it can hand back an accurate
  not-set/already-set/will-overwrite/already-matches hint the moment a target is added, without
  `CopyItemDialogComponent` needing a second lookup mechanism. Emits one `targetPicked:
  {level, scope, options?, existing?}` event and never calls `CopyFacade` itself — Single
  Responsibility, it only decides *what target*, never performs the copy.

## Wired into `DashboardShellComponent`

`app-ledger` renders in `<main>` whenever `viewMode() !== 'compare'`. `DashboardShellComponent`
owns the modal state: `(deleteItem)` → `ItemMutationsFacade` + `ConfirmDialogComponent`; `(add)`/
`(addToSection)`/`(editItem)` → `editorState` signal rendering `ItemEditorPanelComponent`
(`features/item-editor/`); `(copyItem)` → `copyTarget` signal rendering `app-copy-item-dialog`;
`(pasteToSection)` → `HandlePasteToSection`, which also opens `ItemEditorPanelComponent`'s create
flow but pre-fills it from `VariableClipboardService`'s buffer (see `features/item-editor/README.md`
for the `initialValue` input this relies on).

## Testing notes

`LedgerRowComponent`/`SectionHeaderComponent`/`FilterBarComponent` take no Facade/query
dependencies, so their specs don't need `ProvideTestQueryClient()` or a seeded session — plain
`TestBed.configureTestingModule` + `setInput()` is enough. `LedgerComponent` itself is the same:
all of its data arrives via `@Input()`, not a Facade, so it's tested the same lightweight way.
`CopyItemDialogComponent` does need the full `ProvideTestQueryClient()`/`SeedFakeSession()` set,
since `CopyFacade` sits on top of real mutations — see `features/item-editor/README.md`'s testing
notes, which apply here identically. `CrossRepoTargetPickerComponent` needs the same set again (it
injects `ScopesFacade`/`EnvironmentsFacade`/`LedgerFacade`, all real queries), so its own spec is
written the same way rather than shallow-rendered with a stub. Since both of those async queries
have to resolve before a cross-repo target can actually be added, `CopyItemDialogComponent`'s
cross-repo tests (and `CrossRepoTargetPickerComponent`'s own spec) now use the `WaitFor` machinery
described in `core/testing/README.md` too — that's no longer exclusive to
`DashboardShellComponent`'s spec.
