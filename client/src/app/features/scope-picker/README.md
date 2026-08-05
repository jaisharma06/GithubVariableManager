# features/scope-picker

Search and choose an organization or repository to manage.

## Contents

- **`ScopePicker.component.ts`/`.html`** — the whole feature is one component. Injects
  `ScopesFacade` (for the org/repo lists),
  `AuthService` (protected, read in the template for the viewer's name/avatar), `LastScopeService`
  (the "jump back in" shortcut), and `Router`.
  - `orgsQuery`/`reposQuery` come from `ScopesFacade.MyOrgsQuery()`/`MyReposQuery()` — called as
    **methods**, not read off shared facade fields. See `core/facades/README.md` for why: this
    facade is a root singleton, so a shared field would start fetching for every consumer, not
    just this one.
  - `query` is a signal fed by the search box; `filteredOrgs`/`filteredRepos`/`loading` are
    `computed()` off it and the two queries.
  - The search input is focused programmatically in `ngAfterViewInit()` via `@ViewChild`, not the
    `autofocus` attribute — `@angular-eslint/template/no-autofocus` flags `autofocus` as a real
    a11y anti-pattern, and this delivers the same "ready to type" UX without it. Same pattern used
    by `ConfirmDialogComponent` and `RenameEnvironmentDialogComponent`.

## Testing notes

`ScopePicker.component.spec.ts` needs `ProvideTestQueryClient()` (for `injectQuery`) and a fake
`SCOPES_GATEWAY` provider. Because `MyOrgsQuery`/`MyReposQuery` are backed by TanStack Angular
Query, which runs its subscriptions **outside NgZone**, `fixture.whenStable()` cannot observe them
resolving — the spec polls for real with `core/testing/WaitFor.ts` instead. See
`core/testing/README.md` for the full explanation.
