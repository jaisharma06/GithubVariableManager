# features/item-editor

## Contents

- **`ItemEditorPanel.component.ts`/`.html`** — `ItemEditorPanelComponent`. Handles both create and
  edit for a variable or secret at any level, including:
  - Level/environment/kind selection (locked to plain text once editing, or when `lockTarget()` is
    set — used when the target scope+name is already decided, e.g. from a compare-view cell).
  - Name-pattern validation and the secret-rename note (GitHub can't rename a secret in place — a
    "rename" is create-under-new-name-then-delete, same as `RenameEnvironmentDialogComponent`'s
    environment-level version of the same constraint).
  - "Also create in other environments" replicate checkboxes at creation time, via `CopyFacade`.
  - The org-level secret visibility picker (all/private/selected repositories), backed by
    `ScopesFacade.OrgReposQuery` — only fetches once "Selected repositories" is actually chosen
    (`enabled: needsVisibilityPicker() && visibility() === 'selected'`), not eagerly.

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

Needs `ProvideTestQueryClient()`, fake `VARIABLES_GATEWAY`/`SECRETS_GATEWAY`/`SCOPES_GATEWAY`
providers, and `SeedFakeSession()`/`ClearFakeSession()` — `ScopesFacade.OrgReposQuery` is a real
query. Mutation-driven assertions (create/update/replicate) use `fakeAsync()` + `tick()`; the
org-repos-on-selected-visibility assertion is the one real query path in this component and uses
`WaitFor()` instead. See `core/testing/README.md` for why the two patterns aren't interchangeable.
