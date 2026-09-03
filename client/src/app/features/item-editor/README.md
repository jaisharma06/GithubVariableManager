# features/item-editor

## Contents

- **`ItemEditorPanel.component.ts`/`.html`** — `ItemEditorPanelComponent`. Handles both create and
  edit for a variable or secret at any level, including:
  - Level/environment/kind selection (locked to plain text once editing, or when `lockTarget()` is
    set — used when the target scope+name is already decided, e.g. from a compare-view cell).
  - Name-pattern validation and the secret-rename note (GitHub can't rename a secret in place — a
    "rename" is create-under-new-name-then-delete, same as `RenameEnvironmentDialogComponent`'s
    environment-level version of the same constraint). As of Phase 3b the backend can report that
    a rename partially succeeded (new name created, but the old name's delete failed — there's no
    GitHub API making the two-step rename transactional); `HandleSubmit` surfaces that via
    `renameDeleteWarning`, reusing the same warning-banner shape as `replicateFailures` below
    rather than inventing new UI for a second kind of partial-failure outcome.
  - "Also create in other environments" replicate checkboxes at creation time, via `CopyFacade`.
  - The org-level secret visibility picker (all/private/selected repositories), backed by
    `ScopesFacade.OrgReposQuery` — only fetches once "Selected repositories" is actually chosen
    (`enabled: needsVisibilityPicker() && visibility() === 'selected'`), not eagerly.
  - A later, non-phase-numbered addition: an `initialValue` input, used only by the create flow
    (`pastedFromClipboard` is `false` whenever `isEdit()` or `lockTarget()` is set), seeding the
    form's `value` signal when the panel is opened via `DashboardShellComponent.HandlePasteToSection`
    from `VariableClipboardService`'s buffer. Whenever `initialValue()` is set, the panel shows a
    "FROM CLIPBOARD" badge next to the "Add" heading — reusing `KindBadgeComponent`'s visual recipe
    (same `inline-flex`/`rounded`/`px-1.5 py-0.5`/`font-mono text-[10px]` classes) rather than the
    component itself, since this badge always renders the same fixed text/tone rather than switching
    on a `kind` the way `KindBadgeComponent` does — so a reader can tell a pre-filled form apart from
    a blank "+ Add" one at a glance.
  - Another later, non-phase-numbered addition: composite-variable (`$(OtherVarName)`) live
    authoring feedback, variables only — a secret's value gets no composite UI at all, per the
    write-only constraint. `ScheduleResolvePreview` debounces
    (`RESOLVE_PREVIEW_DEBOUNCE_MS` = 400ms) a call to `LedgerFacade.ResolveVariable` (`POST
    /api/ledger/variables/resolve`, preview-only, never writes) whenever the value looks composite
    (`IsCompositeValue`, from `core/facades/LedgerSupport.ts`) — cleared immediately, no debounce,
    the moment it stops being composite, so a stale preview never lingers. Fired from every input
    that could change what the formula resolves against — value, name (a formula can self-reference
    the name it's being saved under), level, and environment changes — not just the value textarea.
    `resolvePreview`/`resolvingPreview` signals back the "Resolving…" / resolved-value-or-circular-
    error card shown under the value field; a failed preview call clears silently (soft, best-effort
    convenience — never blocks saving). `HandleSubmit` also does its own client-side fast check
    against `resolvePreview()?.circular` before submitting, purely for snappier feedback — a submit
    fired right after typing, before the debounce lands, still falls through to
    `ItemMutationService`'s own pre-write validation server-side, which is the authoritative
    backstop and the only thing an *unresolved* (non-circular) forward reference is checked against
    at all (it's allowed to save, deliberately never blocked — see `docs/Architecture.md`'s
    composite-variables section). `ngOnDestroy` clears the debounce timer so a pending preview call
    never fires after the panel closes.
  - A later addition on top of the above, from the composite-variable feature's manifest-based
    redesign (see `docs/Architecture.md`'s composite-variables section for the full design): the
    edit-flow seeding fix. Editing an existing composite variable seeds the value box from
    `initial.formula` (the raw `$(...)` text tracked in the item's scope's manifest), **not**
    `initial.value` — `initial.value` is now always the real, already-resolved GitHub literal for a
    composite row, not the formula, so seeding from `value` the way a plain item does would silently
    detach the row from its own formula on re-save (a resolved literal doesn't match the composite
    regex, so a re-save would just write that literal back as an inert plain value, quietly losing
    the manifest entry). The seeding falls back to `initial.value` when there's no `formula` (a plain
    item) and to `initialValue()` (the clipboard-paste seed) only for a brand-new create. Also new: a
    `manifestSyncWarning` signal/banner, shown after a create/update whose variable write succeeded
    but whose best-effort composite-manifest update (`UpsertVariableResponse.ManifestSynced`) did
    not — reuses the same warning-banner shape as `replicateFailures`/`renameDeleteWarning` above
    rather than inventing new UI for a third kind of partial-failure outcome. This is a genuinely
    different situation from a plain save failure: the variable itself is safely saved with a
    working, correct literal value on GitHub — only the app's record of "this was a formula" failed
    to update, recoverable by simply re-saving the same formula again.

  **Built with plain writable signals + manual `(input)`/`(change)` handlers, not Angular Reactive
  Forms.** Every other form-like component in this codebase (`ScopeSidebarComponent`'s
  new-environment form, `RenameEnvironmentDialogComponent`) uses the same plain-signal pattern —
  introducing Reactive Forms for this one component would mean two different form patterns living
  side by side for no behavioral gain (this form's validation is a single regex check, not the
  kind of cross-field, dynamically-revalidated logic Reactive Forms earns its complexity for).
  Consistency with the rest of the codebase won out — see `docs/CodingStandards.md`'s "patterns
  must justify themselves" rule.

  All the writable signals this component seeds from inputs (`level`/`envName`/`kind`/`name`/
  `value`/`visibility`) are set in `ngOnInit()`, not field initializers — same NG0950 reasoning as
  `RenameEnvironmentDialogComponent`; see `core/testing/README.md`.

## Testing notes

Needs `ProvideTestQueryClient()`, fake `VARIABLES_GATEWAY`/`SECRETS_GATEWAY`/`SCOPES_GATEWAY`/
`OAUTH_GATEWAY`/`LEDGER_GATEWAY` providers, and `SeedFakeSession()`/`ClearFakeSession()` —
`ScopesFacade.OrgReposQuery` is a real query, and `LEDGER_GATEWAY` (`CreateFakeLedgerGateway()`)
backs `CopyFacade`'s Phase 6 single `Copy` call for the replicate-to-environments path — the same
fake `LEDGER_GATEWAY` also backs the later composite-variable `ResolveVariable` preview calls, via
its `CreateFakeLedgerGateway()` spy. Mutation-
driven assertions (create/update/replicate) use `fakeAsync()` + `tick()`; the
org-repos-on-selected-visibility assertion is the one real query path in this component and uses
`WaitFor()` instead. See `core/testing/README.md` for why the two patterns aren't interchangeable.
The composite-resolve preview's debounce (`RESOLVE_PREVIEW_DEBOUNCE_MS`) also needs `tick(400)` (or
`fakeAsync`'s `flush()`) before asserting on `resolvePreview()`/`resolvingPreview()` — see
`ItemEditorPanel.component.spec.ts`.
