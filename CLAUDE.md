# Project orientation for AI agents

This file is auto-loaded every session. Read it first — it's the map to everything else.

## What this repo is

**GitHub Variables Manager** — a single unified view of GitHub Actions variables and secrets
across organization/repository/environment scope levels. The application is a two-piece
architecture: `client/` (Angular 19 + TypeScript, standalone components) is a rendering-only UI;
`api/` (ASP.NET Core Web API, .NET 9) is the backend that owns all GitHub API calls and
business/orchestration logic, for every vertical — Auth, Scopes, Ledger (Variables/Secrets/
Environments), Runners, Workflows, and the batch Copy/Delete-everywhere operations (see
`docs/Architecture.md`). `server/`, the old Express OAuth relay it replaced, was retired in Phase 1
and no longer exists. See the docs below for the full picture — don't re-derive architecture from
scratch by grepping when a doc already explains it.

This repo also contains `archive/` — an earlier React implementation and its migration record,
kept purely for historical reference. Nothing in `archive/` is required reading, and no new work
happens there — see `archive/README.md` if you're ever specifically asked about it.

## Read these, in this order, before planning or implementing anything non-trivial

1. [`docs/Architecture.md`](./docs/Architecture.md) — how the app works: module layout, data flow,
   the hard "secrets are write-only" GitHub constraint that shapes several features, design
   patterns in use and why.
2. [`docs/CodingStandards.md`](./docs/CodingStandards.md) — naming convention (PascalCase files
   and methods, camelCase variables — an explicit, intentional project rule), SOLID application,
   and the rule that design patterns must justify themselves against a real problem here.
3. [`README.md`](./README.md) — the user-facing overview: features, setup, how to run it.
4. `api/README.md` — the ASP.NET Core backend's purpose and internal layering, when your task
   touches `api/`.

Each folder under `client/src/app/` (`core/gateways/`, `core/facades/`, `core/services/`,
`core/interceptors/`, every `features/*/`, `shared/components/`) also has its own `README.md` with
folder-specific detail — read the relevant one before changing code there.

## Working with this repo — the four project agents

Four sub-agents are set up under `.claude/agents/`, named after Justice League members per this
project's convention. They operate across the whole repo — `client/` and `api/` alike, not just
the Angular app — their descriptions are stack-agnostic by design.

- **Batman** — the Planner and the **documentation owner**. Read-only for source code; the only
  agent with `Edit`/`Write` access, scoped to documentation. The best source of codebase
  understanding; produces plans. Invoke first for "how does X work" or "what's the right approach
  for Y" questions — and invoke again *after* Superman/Flash/Green Lantern finish, to bring every
  affected doc in sync with what actually got built (see below).
- **Superman** — Feature Implementer. Builds new features end-to-end (either stack), following
  `docs/CodingStandards.md`. Should be given Batman's plan/findings as context, not asked to
  explore the whole codebase cold.
- **Flash** — Bug Fixer. Diagnoses and applies the smallest correct fix for bugs/small issues.
  Same expectation: give it Batman's context rather than starting cold.
- **Green Lantern** — UI/Visual Implementer. Builds and reshapes `client/`'s presentational
  surface — component templates/styles, `shared/components/`, layout, responsiveness,
  accessibility, visual polish. Does not add business/orchestration logic to a Facade (that's
  still `api/`'s job, or Superman's if it's a genuine cross-stack feature) — a UI task that turns
  out to need a new decision from the backend gets flagged back to you rather than faked
  client-side. Use for "make this look/behave better," "build this screen's layout," "polish this
  component" — not for wiring up new data/mutations (that's Superman) or diagnosing why something's
  broken (that's Flash, unless the bug is purely visual).

**How the "relies on Batman" dependency actually works**: a sub-agent can't call another sub-agent
mid-task on its own. The intended workflow is for *you* (the orchestrating session) to invoke
Batman first, then pass its findings/plan into the prompt you give Superman, Flash, or Green
Lantern. Don't invoke the other three cold on anything beyond a trivial, self-contained change.

**The loop closes with Batman too, not just opens with it.** Once Superman/Flash/Green Lantern
report a change done, invoke Batman again — with a summary of what changed and which files, or
point it at the diff — specifically to bring documentation in sync with the new reality. Batman is
the only agent with write access to docs precisely so this is one accountable owner's job, not
something every implementer has to remember to get right on their own for every affected file.
Treat a change as actually finished only once this documentation pass has happened, not the moment
the code itself works — a change whose docs don't match it yet is unfinished, not done-with-a-TODO.

**How agents share progress while working.** Agents used to be silent until their final report —
the orchestrating session (and the user) had no visibility into what an agent was doing mid-task.
All four now treat the shared task board (`TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`) as a
live status channel, not just a todo list.

**If those tools aren't already available in your context, load them first** — call `ToolSearch`
with query `select:TaskCreate,TaskUpdate,TaskList,TaskGet` before your first attempt to use any of
them. A sub-agent's tool context doesn't always come pre-loaded with every tool the orchestrating
session already has, even when nothing in this file restricts access to them — don't silently skip
the status-update convention just because a call fails once; load the schema and retry.

- On starting substantive work, claim or create a task (`status: in_progress`, `owner` set to the
  agent's name, `activeForm` a short present-continuous line — e.g. "Tracing the ledger fan-out
  logic") so what an agent is doing right now is answerable via `TaskList` without waiting for it
  to finish.
- At natural checkpoints (research done, a key finding, about to start a risky step, hit a
  blocker) — post a short update via `TaskUpdate`, **appending** to the task's `description` rather
  than replacing it, so a running log builds up over the task's lifetime instead of a single
  before/after snapshot.
- Before starting, check `TaskList` for anything already `in_progress` that overlaps — pick up
  useful context left behind rather than duplicating work another agent (or an earlier dispatch)
  already did.
- On finishing, post a final `TaskUpdate` summarizing the outcome and mark it `completed`, before
  returning the final report text. The report is still the authoritative handoff; the task-board
  trail is what makes "what's this agent doing" visible while it's still running.
- If the orchestrating session already created a task for the dispatch and named its ID in the
  prompt, update *that* task rather than creating a new one — keeps one task per unit of work
  instead of a fork per agent.

**These agents are IDE-agnostic.** `.claude/agents/*.md` is plain project-level configuration read
by Claude Code regardless of which surface it's running in:

- The Claude Code CLI, directly.
- The **Claude Code VS Code extension**.
- The **Claude Code JetBrains plugin** (IntelliJ, WebStorm, Rider, Android Studio, …).
- **Visual Studio** (the full IDE, not VS Code) — it has no native Claude Code extension, but
  running the CLI from its integrated terminal is the identical tool with identical behavior; the
  agents don't know or care which terminal launched them.

Behavior is the same across all of them: same four agents, same descriptions, same tool access,
same workflow. There's no separate per-editor configuration to maintain — don't create one. If an
agent's instructions ever need to change, edit the one file under `.claude/agents/`; it takes
effect everywhere at once.

## Non-negotiable constraints (don't "fix" these — they're by design)

- **Secrets are write-only.** GitHub's API never returns a secret's value, to anyone, at any
  level. Every feature that touches secrets (copy, rename, compare) is built around this — see
  `docs/Architecture.md`'s dedicated section. As of Phase 3b, the libsodium sealed-box encryption
  step that satisfies this constraint happens server-side (`api/Services/SecretSealingService.cs`),
  not client-side — plaintext transits from `client/` to `api/` over the same
  `Authorization: Bearer`-authenticated request, transiently, never logged or persisted. That's an
  implementation detail of *where sealing happens*; the platform fact itself — GitHub itself never
  returns a secret's value, to anyone, at any level — is unchanged. If a task seems to require
  reading back a secret's value, the task's premise is wrong, not the code.
- **No server-side database, ever, anywhere in this repo — including `api/`.** The user's GitHub
  token is sent as an `Authorization: Bearer` header on every request from `client/`, forwarded to
  GitHub per-request via Octokit, and never persisted (no session store, no database, no on-disk
  cache). See `docs/Architecture.md`'s "The ASP.NET Core migration" section for the full token
  pass-through model.
- **Business/API decision logic belongs in `api/`; `client/` only renders and reflects
  already-decided state.** This is the completed end-state of the ASP.NET Core migration (see
  `docs/Architecture.md`) — don't add new business logic to a `client/` Facade; extend the backend
  Service instead.
- **`archive/` is historical, not a second codebase to keep in sync.** Don't port new features
  into it, don't "fix" it to match `client/`, and don't delete it without being asked.

## Conventions quick-reference

- File names: **PascalCase**. Methods: **PascalCase**. Variables/properties: **camelCase**. See
  `docs/CodingStandards.md` for the full rule and the Angular-specific exception
  (`.component.ts`/`.service.ts` suffixes stay lowercase — they're tooling metadata).
- Before calling a change done: `ng build` (dev + prod), `ng lint`, `ng test` all clean for
  `client/`; `dotnet build`, `dotnet test` all clean for `api/`. See
  `docs/CodingStandards.md#verification-expectations`.
