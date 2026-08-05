# web/ — original React implementation (archived)

This was the original implementation of GitHub Variables Manager, built in React. It has been
superseded by the Angular app at [`../../client/`](../../client/), which is now the live,
actively developed application — see the root [`README.md`](../../README.md) for setup and usage.

This folder is kept for reference and comparison, not deleted, but it's no longer where new
features or fixes land.

## Why it's still here

- Useful to diff against if a behavior in `client/` ever looks wrong, or as a reference
  implementation for anyone curious how a given feature worked in React.
- Nothing about keeping it costs anything: it's not part of the default `npm run dev`/build path,
  and it doesn't share any runtime state with `client/` (each has its own `localStorage` session,
  since `localStorage` is scoped per browser origin+port).

## Running it anyway

Still fully functional — it talks to the same `api.github.com` and the same `server/` OAuth relay
`client/` uses:

```bash
npm run dev:archive:web   # from the repo root — starts this app alone, at http://localhost:5173
```

(`npm run dev`, the default, starts `server/` + `client/` instead — see the root
[`README.md`](../../README.md).)

## Current documentation

The root [`README.md`](../../README.md), [`CLAUDE.md`](../../CLAUDE.md), and
[`docs/`](../../docs/) all describe `client/` — this app isn't separately documented beyond this
file. See [`../AngularMigrationPlan.md`](../AngularMigrationPlan.md) for the full record of how
this React app was ported to Angular (that document, written during the migration, refers to the
Angular app by its folder name at the time, `angular/` — it was renamed to `client/` afterward),
including a file-by-file mapping table if you need to find where a given piece of this code ended
up.
