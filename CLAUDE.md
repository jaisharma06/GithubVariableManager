# Project orientation for AI agents

This file is auto-loaded every session. Read it first — it's the map to everything else.

## What this repo is

**GitHub Variables Manager** — a single unified view of GitHub Actions variables and secrets
across organization/repository/environment scope levels. The application is `client/` (Angular
19 + TypeScript, standalone components) with a minimal Express OAuth relay (`server/`); an
ASP.NET Core backend is a possible future addition. See the docs below for the full picture —
don't re-derive architecture from scratch by grepping when a doc already explains it.

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

Each folder under `client/src/app/` (`core/gateways/`, `core/facades/`, `core/services/`,
`core/interceptors/`, every `features/*/`, `shared/components/`) also has its own `README.md` with
folder-specific detail — read the relevant one before changing code there.

## Working with this repo — the three project agents

Three sub-agents are set up under `.claude/agents/`, named after Justice League members per this
project's convention:

- **Batman** — the Planner. Read-only. The best source of codebase understanding; produces plans.
  Invoke first for "how does X work" or "what's the right approach for Y" questions.
- **Superman** — Feature Implementer. Builds new features end-to-end, following
  `docs/CodingStandards.md`. Should be given Batman's plan/findings as context, not asked to
  explore the whole codebase cold.
- **Flash** — Bug Fixer. Diagnoses and applies the smallest correct fix for bugs/small issues.
  Same expectation: give it Batman's context rather than starting cold.

**How the "relies on Batman" dependency actually works**: a sub-agent can't call another sub-agent
mid-task on its own. The intended workflow is for *you* (the orchestrating session) to invoke
Batman first, then pass its findings/plan into the prompt you give Superman or Flash. Don't invoke
Superman or Flash cold on anything beyond a trivial, self-contained change.

**These agents are IDE-agnostic.** `.claude/agents/*.md` is plain project-level configuration read
by Claude Code regardless of which surface it's running in:

- The Claude Code CLI, directly.
- The **Claude Code VS Code extension**.
- The **Claude Code JetBrains plugin** (IntelliJ, WebStorm, Rider, Android Studio, …).
- **Visual Studio** (the full IDE, not VS Code) — it has no native Claude Code extension, but
  running the CLI from its integrated terminal is the identical tool with identical behavior; the
  agents don't know or care which terminal launched them.

Behavior is the same across all of them: same three agents, same descriptions, same tool access,
same workflow. There's no separate per-editor configuration to maintain — don't create one. If an
agent's instructions ever need to change, edit the one file under `.claude/agents/`; it takes
effect everywhere at once.

## Non-negotiable constraints (don't "fix" these — they're by design)

- **Secrets are write-only.** GitHub's API never returns a secret's value, to anyone, at any
  level. Every feature that touches secrets (copy, rename, compare) is built around this — see
  `docs/Architecture.md`'s dedicated section. If a task seems to require reading back a secret's
  value, the task's premise is wrong, not the code.
- **No server-side database, ever** — the Express `server/` exists solely to relay two OAuth
  endpoints GitHub doesn't serve with CORS headers. It never sees the user's GitHub token.
- **`archive/` is historical, not a second codebase to keep in sync.** Don't port new features
  into it, don't "fix" it to match `client/`, and don't delete it without being asked.

## Conventions quick-reference

- File names: **PascalCase**. Methods: **PascalCase**. Variables/properties: **camelCase**. See
  `docs/CodingStandards.md` for the full rule and the Angular-specific exception
  (`.component.ts`/`.service.ts` suffixes stay lowercase — they're tooling metadata).
- Before calling a change done: `ng build` (dev + prod), `ng lint`, `ng test` all clean. See
  `docs/CodingStandards.md#verification-expectations`.
