# archive/

Everything here is historical — kept for reference, not part of the live app. Nothing in this
folder is required reading to work on the current codebase; start at the root
[`README.md`](../README.md) and [`CLAUDE.md`](../CLAUDE.md) instead.

## Contents

- **[`web/`](./web/)** — the original React implementation of GitHub Variables Manager, superseded
  by [`../client/`](../client/). Still fully functional on its own (`npm run dev:archive:web`
  from the repo root) — see [`web/README.md`](./web/README.md).
- **[`AngularMigrationPlan.md`](./AngularMigrationPlan.md)** — the plan and phase-by-phase build
  log for the React → Angular port: target architecture, a file-by-file mapping from the old React
  code to its Angular equivalent, design decisions with reasoning, and a phase-by-phase record of
  real bugs found and fixed. Useful if you're asking "why does this Angular code look the way it
  does" and the answer isn't obvious from the current code alone.
