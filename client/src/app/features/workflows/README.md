# features/workflows

## Contents

- **`WorkflowsView.component.ts`/`.html`** — `WorkflowsViewComponent`. Takes `org`/`repo` as
  required signal inputs (same shape as `CompareViewComponent`'s scope input, adjusted to the two
  separate strings `DashboardShellComponent` already has on hand). Lists a repo's Actions workflows
  on the left, the selected workflow's latest 30 runs on the right, and **owns its own
  selection/dialog state internally** rather than bubbling it up to `DashboardShellComponent` — same
  rationale as `CompareViewComponent` (see `features/compare/README.md`): which workflow is
  selected, which runs are checked, and whether the delete confirmation is open are all purely local
  to this view.
  - `selectedWorkflowId` drives `WorkflowsFacade.WorkflowRunsQuery`, which auto-refreshes the runs
    list every 5s while any visible run is still in flight (`status !== 'completed'`) and stops
    polling entirely once every visible run has settled — no manual refresh needed to see a running
    workflow finish. See `core/facades/README.md`'s `WorkflowsFacade.ts` entry for the polling
    mechanics.
  - `selectedRunIds` is a `Set<number>` of checked run ids, scoped to the currently-displayed page
    of 30 runs (checking "select all" only selects what's visible — it does not fetch or select a
    workflow's full history). It's cleared whenever a different workflow is selected, and pruned
    down to whatever ids are still present in `runs()` via a `constructor()` `effect()` whenever a
    poll changes the visible run list — keeps "Delete N runs?" honest with what's actually still
    checked rather than referencing a run that scrolled off the list or was replaced by a poll.
  - A single run can be deleted from its row (`WorkflowsFacade.deleteWorkflowRun`); a 403 there
    surfaces as "deleting workflow runs requires write access to this repository" in a banner above
    the runs list.
  - "Delete selected" is enabled only once `selectedRunIds` is non-empty, and opens
    `ConfirmDialogComponent` with `WorkflowsFacade.DeleteRuns` behind it. The dialog title reads the
    live selected count (e.g. "Delete 2 runs?") and stays live across a retry. The dialog is
    explicit about two things GitHub's platform shape makes true here: this deletes the selected
    runs one at a time and can take a while for a large selection, and it only clears run history —
    if the workflow's YAML file still exists in the repo, GitHub may re-list the workflow once it
    runs again. Progress (`done`/`total`) renders live in the dialog via `DeleteRuns`'s `onProgress`
    callback — as of Phase 5 (the ASP.NET Core migration's Workflows vertical), this progress is
    backend-driven: `DeleteRuns` starts a cleanup job server-side and polls it, rather than chunking
    the deletes itself, but the UX (a live "Deleting N of M…" line, per-poll progress) is unchanged
    from the caller's perspective. On a partial failure, `selectedRunIds` is narrowed down to just
    the failed ids, so clicking confirm again only retries what didn't succeed — `DeleteRuns` works
    off a fixed, caller-supplied id list rather than re-fetching current state, so this narrowing is
    what keeps a retry correct.
- **`WorkflowRunsList.component.ts`/`.html`** — `WorkflowRunsListComponent`. Purely
  `@Input()`-driven (`runs`, `deletingRunId`, `selectedRunIds`) plus `deleteRun`/`toggleRun`/
  `toggleSelectAll` outputs — no facade, no query, and it never computes the next selection itself
  (that stays in `WorkflowsView`, matching `ItemEditorPanel.component.ts`'s `ToggleRepo`/
  `ToggleReplicateEnv` Set-based idiom). Renders a leading checkbox column: a per-row checkbox
  reflecting `selectedRunIds().has(run.id)`, and a header checkbox whose `[indeterminate]` state
  reflects a strict non-empty subset being selected. Status/conclusion → label/color mapping is real
  branching logic (GitHub's `status` covers the in-flight lifecycle; `conclusion` only means
  something once `status` is `'completed'`), so it gets its own small methods
  (`WorkflowRunStatusLabel`/`WorkflowRunStatusClass`/`WorkflowRunDotClass`), mirroring
  `RunnersPanel.component.ts`'s `RunnerState`/`RunnerDotClass` pattern rather than a Strategy-pattern
  class hierarchy (see `core/strategies/README.md` for why that's declined elsewhere in this app
  too).
- A single workflow's row (name, path, state) is inlined directly in
  `WorkflowsView.component.html` rather than split into its own component — it has exactly one call
  site, the same "don't over-split a shallow, single-use concern" reasoning `FilterBar.component.ts`
  documents for its own inlined pill groups.

## Wired into `DashboardShellComponent`

`app-workflows-view` renders in `<main>` whenever `viewMode() === 'workflows'` for a repo scope; the
List/Compare/Workflows toggle lives in the header.

## Testing notes

Needs `ProvideTestQueryClient()`, a fake `WORKFLOWS_GATEWAY` provider
(`CreateFakeWorkflowsGateway()`), and `SeedFakeSession()`/`ClearFakeSession()` — same requirement
set as every other Facade-backed component. `WorkflowsQuery`/`WorkflowRunsQuery` assertions use
`WaitFor` (queries run outside `NgZone` — see `core/testing/README.md`); `deleteWorkflowRun`/
`DeleteRuns` assertions use `fakeAsync()` + `tick()` (directly-awaited mutation flows). As of Phase
5, `DeleteRuns`'s tests mock `StartRunCleanup`/`PollRunCleanup` rather than `DeleteWorkflowRun`
directly, and need one `tick()` per chained `await` in the start+poll sequence (one for
`StartRunCleanup`, one per `PollRunCleanup` resolution); a test asserting incremental progress
across multiple polls needs `tick(WORKFLOW_CLEANUP_POLL_INTERVAL_MS)` between staged
`PollRunCleanup` resolutions, mirroring `OAuthDeviceFlow.component.spec.ts`'s
`tick(FAKE_DEVICE.interval * 1000)` idiom. `WorkflowRunsListComponent`'s spec needs neither, being
purely `@Input()`-driven like `LedgerRowComponent`'s.
