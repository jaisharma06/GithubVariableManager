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
backs `CopyFacade`'s Phase 6 single `Copy` call for the replicate-to-environments path. Mutation-
driven assertions (create/update/replicate) use `fakeAsync()` + `tick()`; the
org-repos-on-selected-visibility assertion is the one real query path in this component and uses
`WaitFor()` instead. See `core/testing/README.md` for why the two patterns aren't interchangeable.
