# GitHub Variables Manager — Angular

This is the application. Root `npm run dev` runs this workspace (plus `server/`, the OAuth relay)
— see the repo-root [`README.md`](../README.md) for setup, usage, and features.

## What's here

Angular 19.2, standalone components (no `NgModule`s), Tailwind CSS wired to the same design
tokens throughout, `@tanstack/angular-query-experimental` for server-state/caching, Angular
Router with `loadComponent` per feature for lazy loading.

```
src/app/
  core/
    gateways/       Typed GitHub REST client (one Gateway interface + impl per resource)
    facades/        Feature-facing state layer wrapping TanStack Angular Query
    services/       AuthService, SecretSealingService, RateLimitService, LastScopeService
    interceptors/   AuthInterceptor, RateLimitInterceptor
    strategies/      Intentionally empty — see its own README.md
    Types.ts          Shared domain types
  features/
    auth/            Connect screen (PAT + OAuth device flow), route guard
    scope-picker/     Choose an org or repo
    dashboard/        Screen shell: sidebar, runners panel, rename-environment dialog
    ledger/           The main variables/secrets list + copy-to-scopes dialog
    item-editor/      Create/edit slide-over panel
    compare/          Matrix view for comparing/editing across scopes
  shared/components/  Button, KindBadge, ConfirmDialog, Avatar, RateLimitIndicator
```

Every folder above has its own `README.md` with more detail on what's in it and why — read the
relevant one before changing code there.

Why Angular 19.2 and not the newest release: this machine's Node version (18.20.7) doesn't meet
Angular 20+'s minimum (Node ≥20.19). 19.2 is the newest Angular CLI release that fully supports
Node 18. Revisit once Node is upgraded — nothing else here depends on a specific Angular minor
version.

`ng build` (dev + prod configs), `ng lint`, and `ng test` are all green — verified, not assumed;
re-run them before considering any change done (see `docs/CodingStandards.md#verification-expectations`
at the repo root).

## Troubleshooting a fresh `npm install`

Joining this workspace to the repo root's npm workspaces (so `server` and `angular` share one
`node_modules`) surfaced two known, unrelated npm issues on a clean install in the past. Neither is
a bug in this project's code — if a fresh clone hits either:

- **`ng lint` crashes with `Cannot read properties of undefined (reading 'Intrinsic')`.** Caused by
  a stray, incompatible TypeScript major getting hoisted into the shared `node_modules`. Check
  every workspace's declared `typescript` range is a normal 5.x, then
  `rm -rf node_modules */node_modules package-lock.json && npm install` from the repo root.
- **Build fails with `Cannot find native binding` from `@tailwindcss/oxide`.** This is
  [npm/cli#4828](https://github.com/npm/cli/issues/4828) — a long-standing npm bug where a
  platform-specific optional dependency sometimes doesn't get installed in a workspace/monorepo
  layout. Fix: `npm install @tailwindcss/oxide-<platform> --no-save` from the repo root, where
  `<platform>` matches your OS/arch (e.g. `win32-x64-msvc`, `linux-x64-gnu`, `darwin-arm64`) — check
  `node_modules/@tailwindcss/oxide/package.json`'s `optionalDependencies` for the exact name.

## Conventions

**File names and method/function names are PascalCase; variables and properties are camelCase.**
This is an explicit project decision (see `docs/CodingStandards.md` at the repo root), not the
Angular CLI default — enforced by this workspace's `eslint.config.js`
(`@typescript-eslint/naming-convention` for methods/variables, `eslint-plugin-check-file` for
filenames — the latter with `ignoreMiddleExtensions` so Angular's required
`.component.ts`/`.service.ts` suffix doesn't count against the PascalCase check). Run
`npm run lint` before committing; it will fail loudly on a violation, it's not just documentation.

## Commands

From this folder:

```bash
npm start         # ng serve — dev server at http://localhost:4200
npm run build      # ng build
npm run lint        # ng lint
npm test              # ng test (Karma + Jasmine, headless Chrome)
```

Or from the repo root: `npm run dev:client`.
