# shared/components

Presentational primitives with no feature-specific knowledge:

- `Button.component.ts` — exposes a `Focus()` method (used by `ConfirmDialogComponent` to
  autofocus the confirm button). Consumers bind `(click)` directly on `<app-button>`; there's no
  separate click output — a native click bubbles from the inner `<button>` up through the host
  element like any other nested DOM node.
- `KindBadge.component.ts` — the small "VAR"/"SEC" pill shown next to a ledger row's name.
- `ConfirmDialog.component.ts` — a confirmation modal; its description is projected content
  (`<ng-content>`), so callers needing more than plain text (e.g. a bullet list of affected scopes
  in the delete-everywhere flow) can pass arbitrary markup. Outputs are named
  `confirmed`/`cancelled`, not `confirm`/`cancel` — `@angular-eslint/no-output-native` flags
  `cancel` specifically, since `HTMLDialogElement` and `<input type="file">` both dispatch a real
  native `cancel` event. `confirmLabel` (required) is the button's steady-state text; the optional
  `confirmingLabel` input (defaults to `'Deleting…'`) is swapped in while `confirming` is true, so a
  non-delete destructive confirm — e.g. the composite-variable "flatten to literal" dialog in
  `features/dashboard/` — can show its own pending copy (`"Flattening…"`) instead of every caller
  being stuck with delete-flavored wording.
- `Avatar.component.ts` — shows the account's GitHub profile photo; falls back to (and stays on,
  while the image loads or if it fails) the first-letter initial.
- `RateLimitIndicator.component.ts` — reads `RateLimitService.state` directly (already a signal).

All five have a `*.component.spec.ts` with real assertions, not just "should create" smoke tests.
