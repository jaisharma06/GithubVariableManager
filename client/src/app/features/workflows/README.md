# features/workflows

## Contents

- **`WorkflowsView.component.ts`/`.html`** — `WorkflowsViewComponent`. Takes `org`/`repo` as
  required signal inputs (same shape as `CompareViewComponent`'s scope input, adjusted to the two
  separate strings `DashboardShellComponent` already has on hand). Lists a repo's Actions workflows
  on the left, the selected workflow's latest 30 runs on the right, and **owns its own
  selection/dialog state internally** rather than bubbling it up to `DashboardShellComponent` — same
  rationale as `CompareViewComponent` (see `features/compare/README.md`): which workflow is
  selected, which runs are checked, whether the delete confirmation is open, and which run (if any)
  is open for detail viewing are all purely local to this view.
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
  - `selectedRunForDetail` holds the one run (if any) currently open in the detail panel — set by
    `HandleViewDetail(run)` (fired by `WorkflowRunsListComponent`'s `viewDetail` output) and cleared
    by `HandleCloseDetail()` (fired by `WorkflowRunDetailPanelComponent`'s `closed` output).
    Everything about the detail view itself — the jobs/steps query, the rerun mutation, which jobs
    are expanded — belongs to `WorkflowRunDetailPanelComponent`, not this component: it receives
    only the clicked `WorkflowRun` row via `@Input()` and injects its own `WorkflowsFacade` calls,
    the same "dialog owns its own facade work" shape `CopyItemDialogComponent`/
    `RenameEnvironmentDialogComponent` already use.
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
  `toggleSelectAll`/`viewDetail` outputs — no facade, no query, and it never computes the next
  selection itself (that stays in `WorkflowsView`, matching `ItemEditorPanel.component.ts`'s
  `ToggleRepo`/`ToggleReplicateEnv` Set-based idiom). Renders a leading checkbox column: a per-row
  checkbox reflecting `selectedRunIds().has(run.id)`, and a header checkbox whose `[indeterminate]`
  state reflects a strict non-empty subset being selected. A run's row shows its commit message
  (`run.commitMessage`, falling back to "No commit message") as the primary label rather than the
  run's own `name` — see `WorkflowRunStatus.ts`/backend note below on why. The whole row is a
  `role="button"` click/Enter target that emits `viewDetail`, with `$event.stopPropagation()` on the
  checkbox, the delete button, and the run-number external link so those three still work
  independently of opening the detail panel; a decorative, `aria-hidden` trailing chevron (idle at
  50% opacity, brightens and nudges right on row hover) signals the row is clickable without being a
  second, redundant click target. Status/conclusion → label/color mapping is real branching logic
  (GitHub's `status` covers the in-flight lifecycle; `conclusion` only means something once `status`
  is `'completed'`), so it lives in its own module rather than as component methods — see
  `WorkflowRunStatus.ts` below. Date formatting delegates to `WorkflowRunTiming.ts`'s
  `FormatTimestamp`.
- **`WorkflowRunDetailPanel.component.ts`/`.html`/`.spec.ts`** — `WorkflowRunDetailPanelComponent`.
  The run-detail panel opened by clicking a row in `WorkflowRunsListComponent`: a wide (`max-w-2xl`
  — wider than `ItemEditorPanelComponent`'s default, since job/step rows need the room) right-hand
  slide-over matching `ItemEditorPanelComponent`'s panel shape (backdrop click / Escape to close,
  focuses its close button on open). Takes `org`/`repo`/`run` (the clicked list row) as required
  signal inputs and emits `closed`; owns its own `WorkflowsFacade.WorkflowRunDetailQuery` and
  `rerunWorkflowRun` mutation internally rather than taking them from `WorkflowsView`, the same
  "dialog injects its own facade" shape `CopyItemDialogComponent`/`RenameEnvironmentDialogComponent`
  use. The `run` input is what lets the header render immediately (status dot, commit message, run
  number) before the detail query resolves — the panel never opens empty, and its status pill falls
  back to the clicked row's own `status`/`conclusion` until the query's fuller detail arrives.
  - **Body/summary**: header commit message prefers `detail.commitMessage`, then
    `detail.displayTitle`, then the clicked row's own `commitMessage`, then `detail.name` — see the
    commit-message note below for why `commitMessage` (not `displayTitle`) is preferred everywhere
    else in this feature. A `Created`/`Started`/`Updated`/`Duration` stat row uses
    `WorkflowRunTiming.ts` throughout; `Duration` is only computed once `status === 'completed'`
    (an in-flight run has no defined duration yet).
  - **Jobs/steps**: each job renders as a collapsible card (`ToggleJob`); a job's default open/closed
    state is decided **exactly once**, the first time it appears in `jobs()` (tracked in a private
    `decidedJobIds` `Set`, not derived live from status) — a job that didn't finish cleanly (failed,
    cancelled, or still running) opens by default, a job that settled successfully stays collapsed,
    and a lone job always opens (collapsing it would leave the panel looking empty). Deciding once,
    not live, is deliberate: the detail query re-polls every 5s while the run is in flight, and
    re-deriving open/closed from live status would collapse a job out from under someone reading it
    the moment it finishes. A cleanly-finished step's status label is visually hidden (kept in the
    DOM for screen readers) — its dot color already says "fine", and a 15-step job's steps read as
    noise if every row also spells out "Success".
  - **Rerun**: a "Rerun" button always visible in the panel's footer, calling
    `WorkflowsFacade.rerunWorkflowRun`. **Deliberately no confirmation dialog** — unlike bulk-deleting
    run history (irreversible, hence `ConfirmDialogComponent`), rerunning a workflow run is a
    reversible, low-stakes, and exactly-what-GitHub's-own-UI-does action; adding a confirm step here
    would just be friction with no real safety benefit. Success shows an inline "Rerun started…"
    note (the query itself will pick up the new attempt on its next poll); a 403 shows
    `PermissionAwareMessage(err, 'rerunning a workflow requires write access to this repository')` in
    the same footer area.
  - Errors: the jobs/steps query's own error uses a *third* `lockedHint` phrasing — "reading this
    run's jobs needs access to this repository" — distinct from both the run-delete and rerun
    phrasings, since a 403 reading a run's jobs isn't fundamentally about write access. See
    `WorkflowRunMessages.ts` below.
- **`WorkflowRunStatus.ts`** — `WorkflowRunStatusLabel`/`WorkflowRunStatusClass`/
  `WorkflowRunDotClass`, plain functions over a shared `WorkflowRunStatusInfo` (`{ status,
  conclusion }`) shape. Originally lived as `WorkflowRunsListComponent` methods; extracted into this
  module so the run-detail panel's run header, per-job pills, and per-step pills can all reuse the
  same status/conclusion → label/color vocabulary instead of re-deriving it a second, third, and
  fourth time. Plain functions rather than a class or a Strategy-pattern hierarchy — this branching
  is shallow, same reasoning as `RunnersPanel.component.ts`'s `RunnerState`/`RunnerDotClass` pair
  (see `core/strategies/README.md` for why a formal pattern is declined here too).
- **`WorkflowRunTiming.ts`** — `FormatTimestamp(iso)` (a short, locale-aware absolute timestamp —
  deliberately terse, since the runs list renders it in a 9rem column that a full
  `toLocaleString()` would overflow) and `FormatDuration(startIso, endIso)` (elapsed time, `null`
  until both timestamps exist), plus the shared `NO_TIME` (`'—'`) placeholder. New with the
  run-detail panel; shared by both it and `WorkflowRunsListComponent` (whose Created/Updated columns
  visibly narrowed once they switched to this formatting from a longer inline one). `FormatDuration`
  is deliberately not a live-ticking value — the detail query re-polls every 5s while a run is in
  flight, and a ticking duration would redraw every job/step row on every poll for no real benefit.
- **`WorkflowRunMessages.ts`** — `PermissionAwareMessage(err, lockedHint?)`, one phrasing of "GitHub
  said no" shared by run delete, rerun, and the detail query. Moved out of
  `WorkflowsView.component.ts` (its original home) into its own module specifically so
  `WorkflowRunDetailPanelComponent` can use it without creating a circular import back into the view
  that renders the panel. `lockedHint` lets each caller phrase the same 403 in its own words — "requires
  write access" for the delete/list surface, "rerunning a workflow requires write access" for rerun,
  "reading this run's jobs needs access" for the read-only detail query — since a locked run list, a
  locked rerun, and a locked read aren't the same kind of "no."
- A single workflow's row (name, path, state) is inlined directly in
  `WorkflowsView.component.html` rather than split into its own component — it has exactly one call
  site, the same "don't over-split a shallow, single-use concern" reasoning `FilterBar.component.ts`
  documents for its own inlined pill groups.

## Commit message as a run's display name

A run's row and its detail header show the triggering commit's subject line (first line of the
commit message) rather than GitHub's own `displayTitle` (`WorkflowRunResponse.commitMessage`/
`WorkflowRunDetailResponse.commitMessage`, both computed server-side by
`Services/WorkflowsService.ExtractCommitSubject`). This is deliberate, not an oversight:
`displayTitle` is GitHub's own computed title, and it silently changes if the workflow's YAML sets a
`run-name:` directive — the commit subject is the one thing that's always meaningful and always
present. The detail panel's headline still falls back through `commitMessage` → `displayTitle` →
the clicked row's own `commitMessage` → `name`, for the rare case a run genuinely has no commit
message.

## Wired into `DashboardShellComponent`

`app-workflows-view` renders in `<main>` whenever `viewMode() === 'workflows'` for a repo scope; the
List/Compare/Workflows toggle lives in the header.

## Testing notes

Needs `ProvideTestQueryClient()`, a fake `WORKFLOWS_GATEWAY` provider
(`CreateFakeWorkflowsGateway()`), and `SeedFakeSession()`/`ClearFakeSession()` — same requirement
set as every other Facade-backed component. `WorkflowsQuery`/`WorkflowRunsQuery`/
`WorkflowRunDetailQuery` assertions use `WaitFor` (queries run outside `NgZone` — see
`core/testing/README.md`); `deleteWorkflowRun`/`rerunWorkflowRun`/`DeleteRuns` assertions use
`fakeAsync()` + `tick()` (directly-awaited mutation flows). As of Phase 5, `DeleteRuns`'s tests mock
`StartRunCleanup`/`PollRunCleanup` rather than `DeleteWorkflowRun` directly, and need one `tick()`
per chained `await` in the start+poll sequence (one for `StartRunCleanup`, one per `PollRunCleanup`
resolution); a test asserting incremental progress across multiple polls needs
`tick(WORKFLOW_CLEANUP_POLL_INTERVAL_MS)` between staged `PollRunCleanup` resolutions, mirroring
`OAuthDeviceFlow.component.spec.ts`'s `tick(FAKE_DEVICE.interval * 1000)` idiom.
`WorkflowRunsListComponent`'s spec needs neither, being purely `@Input()`-driven like
`LedgerRowComponent`'s. `WorkflowRunDetailPanelComponent.spec.ts` mocks
`GetWorkflowRunDetail`/`RerunWorkflowRun` on the fake `WORKFLOWS_GATEWAY`, and covers the
default-open-state decision (a failed/in-flight/lone job opens, a cleanly-settled job among several
stays collapsed) and that it's decided once — a poll that changes a job's status after it first
appears must not silently re-collapse or re-expand it under the reader.
