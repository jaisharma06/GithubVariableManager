# GitHub Variables Manager

A single, unified view of every GitHub Actions **variable** and **secret** you have access to — organization, repository, and environment levels together — instead of clicking through a different GitHub settings screen for each one.

![status](https://img.shields.io/badge/status-internal--tool-blue) ![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Why this exists

Managing GitHub Actions configuration is tedious by default: variables and secrets live at three different levels (organization, repository, environment), and GitHub gives each level × type combination its own settings page. Checking or changing a handful of values across a repo and its environments means half a dozen page loads and just as many clicks.

This tool connects to GitHub with your own credentials and gives you one filterable, searchable list of everything in scope — with the ability to create, edit, and delete variables and secrets without leaving the page.

**One real constraint shapes the UI, by design:** GitHub's API can return a *variable's* value, but it can **never** return a *secret's* value — secrets are write-only and never sent back by GitHub, at any level. A new secret's value is sealed (libsodium sealed-box encryption, server-side in `api/`) before it's ever written to GitHub. This app is honest about that: variable values are visible (with a one-click "hide all" toggle before you screen-share), secret rows always show a locked, write-only state instead of a broken "reveal" button that could never work.

## Features

- **One login, everything in scope** — pick an organization or a repository and see its organization-level, repository-level, and every environment's variables/secrets in one place.
- **Two ways to connect** — a GitHub personal access token, or a real "Continue with GitHub" sign-in (OAuth device flow) — your choice. You stay signed in (via `localStorage`, synced across tabs) until you disconnect or GitHub rejects the token — not just until the tab closes.
- **Filter and search** — by level (organization / repository / environment), by type (variable / secret), by environment, or by name.
- **Create, edit, delete** — right from the list, with a level- and environment-aware form. Adding from inside a section pre-fills where the new item belongs.
- **Copy to other scopes** — copy an existing variable or secret's value to one or more other environments (or repo/org level), editable before copying, or check off environments at creation time to fan a new value out to all of them at once. Not limited to the org/repo you currently have open, either: the copy dialog can add a destination in a different repository or organization you have access to, searched and picked the same way the scope picker works.
- **Copy a variable, paste it anywhere** — click a variable row's "copy value" icon (distinct from "copy to other scopes" above) to hold its name and value in an in-app clipboard buffer — it also best-effort mirrors the raw value to your real OS clipboard. A "Paste" button then appears on any section (this org/repo's own sections or a completely different scope you navigate to) to open the "add variable" form pre-filled from the buffer, marked "FROM CLIPBOARD" so you can tell it apart from a blank form — nothing is created until you review and submit it yourself. The buffer sticks around until you copy something else, so pasting the same value into several places in a row is one copy and several pastes, not a copy per paste. Variables only — secrets are write-only, so there's never a value to copy.
- **Copy all variables from one environment to another** — from an environment's row in the sidebar, pick any other environment (in this repo, another repo, or another org entirely) as a destination and copy every one of the source's variables into it in one action. Any occurrence of the source environment's name inside a value is replaced with the destination's name; a variable whose name already exists at the destination is skipped, never overwritten, and the result shows exactly what was copied, skipped, or failed. Both environments must already exist first — this doesn't create one for you.
- **Compare view** — a matrix of every name across whichever environments (and repo/org) you select, with inline edit, per-cell copy, and one-click "delete this from every scope it's in" with a warning listing exactly what's affected.
- **Rename an environment** — GitHub has no rename API for environments, so this creates the new one, copies every variable's value across, and removes the old one (secrets can't be silently carried over — see below — so you're asked to re-add them and confirm before the old environment is deleted).
- **Self-hosted runners at a glance** — a sidebar panel showing every runner assigned to the repo (or org), with live online/offline/busy status.
- **Workflows and run history cleanup** — browse a repo's GitHub Actions workflows, see a workflow's latest 30 runs (labeled by their triggering commit message, not GitHub's own run title, which a workflow's `run-name:` can silently override), which auto-refresh every few seconds while any of them are still in progress and stop updating once they've all finished (no manual refresh needed to watch a run to completion), check off any subset of them (or "select all" for everything currently shown), and bulk-delete the selected run history in one confirmation (GitHub has no bulk-delete API, so this is one delete call per run, batched with progress shown). This is irreversible, and since it only clears run history rather than the workflow definition itself, GitHub may re-list the workflow again once it runs again if its YAML file is still in the repo — the confirmation dialog says so up front.
- **Run detail and rerun** — click any run to open its full detail: per-job status with each job's ordered steps (a job that didn't finish cleanly opens automatically; a clean one stays collapsed), and a one-click "Rerun" button — no confirmation needed, since rerunning a run is reversible and low-stakes, unlike deleting run history.
- **Org-secret visibility control** — choose whether a new organization secret is available to all repos, private repos only, or a hand-picked selection.
- **Honest about secrets** — secret values are never fetched or displayed, because GitHub doesn't allow it; the UI explains why instead of pretending otherwise, everywhere that constraint matters (copy, rename, compare).
- **Export to Excel** — download the current scope's variables and secrets as an `.xlsx` workbook, one sheet per accessible level (organization, repository, each environment) — empty levels are skipped, and inaccessible/errored ones are listed on a `Notes` sheet instead of silently vanishing. Secret rows show a write-only marker instead of a value, the same "honest about secrets" rule the rest of the app follows.
- **Nothing persisted server-side** — no database, in `client/` or `api/` alike; your token lives
  only in your browser's local storage, never on disk anywhere else, and is only ever sent to this
  app's own `api/` backend, which forwards it to GitHub per-request and never stores it.

## How it's built

- **`client/`** — the application: Angular 19 + TypeScript, standalone components, Tailwind CSS,
  `@tanstack/angular-query-experimental` for data fetching/caching. Talks only to this app's own
  `api/` backend — never directly to `api.github.com` or `github.com`. Every Gateway
  (`core/gateways/I*Gateway.ts` + `Backend*Gateway.service.ts`) sends the user's token as an
  `Authorization: Bearer` header on each request.
- **`api/`** — an ASP.NET Core (.NET 9) backend that owns every GitHub API call (via Octokit.NET)
  and all business/orchestration logic: variables, secrets, environments, runners, workflows,
  org/repo scopes, and sign-in (personal-access-token viewer lookup and the OAuth *device flow*,
  including relaying the two `github.com` OAuth endpoints that don't support CORS). Stateless — no
  database, no session store: the token passes through on every request and is never persisted.

```
┌──────────────┐   Authorization: Bearer <token>   ┌──────────────┐   Octokit.NET (same token)   ┌──────────────┐
│ client (SPA) │ ─────────────────────────────────▶│  api :5080   │──────────────────────────────▶│ api.github   │
│  :4200       │                                    │ (ASP.NET Core)│                                │ .com /       │
└──────────────┘                                    └──────────────┘                                │ github.com   │
                                                                                                       │ (OAuth)      │
                                                                                                       └──────────────┘
```

The browser never talks to GitHub directly — every request, including sign-in, goes through `api/`.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later, and npm
- [.NET SDK 9](https://dotnet.microsoft.com/download) (for `api/`)
- A GitHub account with access to the org/repo(s) you want to manage

## Setup and running it

### 1. Install dependencies

From the repository root (this is an npm workspace — one install covers `client`; `api/` restores its own NuGet packages on first `dotnet build`/`dotnet run`):

```bash
npm install
```

### 2. Configure the backend

No configuration needed to get started. Both login options (personal access token and "Continue with GitHub") work out of the box: the OAuth **Client ID** is baked into `api/` as a default, so there's nothing to register or paste in just to get started. (A client ID isn't sensitive — unlike a client secret, it's meant to be public, which is exactly why the device flow doesn't need a secret in the first place.)

### 3. (Optional) Use your own OAuth App instead

If you'd rather have sign-in go through an OAuth App you control instead of the built-in default:

1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**.
2. Fill in any name/homepage URL you like — the callback URL field doesn't matter, it's not used.
3. After creating it, open the app's settings and **enable "Device Flow"**. This is required — without it, sign-in will fail.
4. Copy the **Client ID** into an environment variable for `api/`, overriding the default:
   ```
   GITHUB_OAUTH_CLIENT_ID=your_client_id_here
   ```
   No client secret is needed either way — the device flow never uses one.

### 4. (Optional) Point the frontend at a different backend port

Only needed if you changed `api/`'s port. Edit `client/src/environments/environment.ts`'s `backendApiBaseUrl` (and `environment.prod.ts`'s, if you'll also build for production).

### 5. Run it

From the repository root:

```bash
npm run dev
```

This starts both processes together:

| Service | URL | Purpose |
|---|---|---|
| Client app (Angular) | http://localhost:4200 | The application UI |
| `api/` (ASP.NET Core) | http://localhost:5080 | Every vertical: Auth, Scopes, Ledger (variables/secrets/environments), Runners, Workflows — `client/` talks to nothing else |

Open **http://localhost:4200** in your browser.

`api/` also serves interactive API docs (Swagger UI) at **http://localhost:5080/swagger** while
running in Development — useful for exploring or exercising every route directly, without going
through the Angular UI.

To run them individually: `npm run dev:client` or `npm run dev:api`.

**Verify it's actually working**, if you want to double-check before opening the browser (this is
the exact check used to validate this section of the README against a real run — the API really
does reach `github.com`, no credentials needed for this call):

```bash
curl http://localhost:5080/health                              # {"ok":true}
curl -X POST http://localhost:5080/api/auth/github/device-code  # a real deviceCode/userCode from GitHub
```

If the second command doesn't return a real code, `api/` can't reach `github.com` — check your
network/proxy/firewall before assuming the app itself is broken.

### 6. Build for production

```bash
npm run build -w client        # outputs to client/dist/client
```

Serve the built files with any static file server; point it at the same `api/` instance (or
your own deployment of it) for sign-in to keep working.

## Using the app

### Connect

You'll land on a connect screen with two tabs:

- **Personal access token** — paste a token and click Connect. It needs the `repo` and `admin:org` scopes (classic token), or the equivalent **Variables** and **Secrets** permissions at both repository and organization level (fine-grained token), to read and write at every level. The token is held only in your browser's local storage — it's never written anywhere else on disk, and is only ever sent to this app's own `api/` backend (which forwards it straight through to GitHub per-request and never stores it).
- **GitHub OAuth** — click Continue with GitHub, enter the short code shown at `github.com/login/device`, approve it, and you're in. Works immediately, no setup required.

### Pick a scope

Search and select either an **organization** (shows its org-level variables/secrets) or a **repository** (shows that repo's organization, the repo itself, and every deployment environment on it — everything actually visible to that repo's Actions runs).

### Browse and manage

The ledger groups everything into sections by level, each with a plain-language description of what it means and its own "+ Add" button. Use the filter pills and search box to narrow things down. Toggle **Hide values** to mask every variable at once (handy before sharing your screen) — secret values are always hidden, since GitHub never returns them regardless.

Click a row's edit or delete icon to modify or remove it; deleting always asks for confirmation first.

## Project structure

```
GithubVariablesManager/
├── client/                     # The application
│   └── src/app/
│       ├── core/
│       │   ├── gateways/         # Typed client for api/ (one Gateway interface + impl per
│       │   │                     # resource: variables, secrets, environments, runners, scopes,
│       │   │                     # workflows, auth)
│       │   ├── facades/          # Feature-facing state layer wrapping TanStack Angular Query
│       │   ├── services/         # AuthService, RateLimitService, LastScopeService, …
│       │   └── interceptors/     # Auth-header attach + 401 detection, rate-limit tracking
│       ├── features/
│       │   ├── auth/             # PAT + OAuth device-flow connect screen, route guard
│       │   ├── scope-picker/     # Choose an org or repo
│       │   ├── dashboard/        # Screen shell: sidebar, runners panel, rename-environment and
│       │   │                     # copy-environment-variables dialogs
│       │   ├── ledger/           # The main variables/secrets list + copy-to-scopes dialog +
│       │   │                     # copy-variable-to-clipboard/paste affordances
│       │   ├── item-editor/      # Create/edit slide-over panel
│       │   ├── compare/          # Matrix view for comparing/editing across scopes
│       │   └── workflows/        # Browse workflows, view runs, bulk-delete run history
│       └── shared/components/    # Shared UI primitives (Button, KindBadge, ConfirmDialog, Avatar, …)
├── api/                        # ASP.NET Core (.NET 9) — the backend, owns all GitHub calls and business logic
│   └── src/GithubVariablesManager.Api/
│       ├── Auth/                 # Bearer-token pass-through, centralized permission-error classification
│       ├── Endpoints/            # Route mapping, one file per resource
│       ├── Services/             # Orchestration/business logic per resource
│       └── GitHub/               # Octokit-based outbound client wrapper(s)
├── docs/                       # Architecture and coding standards
└── archive/                    # Historical only — see archive/README.md; not required reading
```

See [`docs/`](./docs/) for how the app is built:
[`Architecture.md`](./docs/Architecture.md) (module layout, data flow, design patterns) and
[`CodingStandards.md`](./docs/CodingStandards.md) (naming/SOLID/pattern rules).

## Tech stack

Angular 19 · TypeScript · Tailwind CSS · `@tanstack/angular-query-experimental` · Angular Router ·
ASP.NET Core (.NET 9) · Octokit.NET · `Sodium.Core` (server-side secret encryption, per GitHub's
documented sealed-box scheme) · `Swashbuckle.AspNetCore` (Swagger/OpenAPI, dev-only) · `ClosedXML`
(server-side `.xlsx` export, MIT-licensed — chosen over the more commonly reached-for `EPPlus`,
which moved to a commercial Polyform Noncommercial license as of v5)

**ASP.NET Core is this app's backend, in full.** Every GitHub API call (variables, secrets,
environments, runners, workflows, org/repo scopes, sign-in) and every piece of orchestration logic
(batch copy, delete-everywhere, environment rename, secret rename) is owned by `api/` —
`client/` only renders what it returns and never talks to `api.github.com` directly. See
[`docs/Architecture.md`](./docs/Architecture.md#the-aspnet-core-migration) for the full design and
the vertical-by-vertical history of how it got there. The frontend still depends only on Gateway
*interfaces* (`core/gateways/I*Gateway.ts`) — that seam is what made each vertical's cutover a
backend swap behind an interface rather than a frontend rewrite, and would do the same for any
future backend change.

## Security notes

- Your GitHub token (PAT or OAuth) is held in `localStorage` in your browser only — it's never
  written anywhere else on disk. It's sent only to this app's own `api/` backend (never directly to
  `api.github.com`), which forwards it straight through to GitHub per-request and never stores it
  (no database, no session, no on-disk cache). It persists until you click **Disconnect** or GitHub
  itself rejects the token (a `401`), at which point every open tab signs itself out automatically.
- Secret **values** are never read back from GitHub, by GitHub's own design — this app can set/update/delete a secret, but can never display its current value. This also means a secret's value can't be silently copied to another scope or carried over when renaming an environment — those flows always ask you to re-enter the value, and say why.
- `api/` has no database and stores nothing between requests — every GitHub call this app makes,
  not just the two CORS-incompatible OAuth endpoints, is proxied through it.
- The default OAuth Client ID baked into `api/` is tied to one shared OAuth App — everyone using the default will see that app's name on GitHub's consent screen. That's fine for an internal team tool; if you're distributing this more broadly, register your own OAuth App (step 3 above) so consent screens reflect your own identity instead.

## Working with AI coding agents

This repo is set up for agent-assisted development:

- **[`CLAUDE.md`](./CLAUDE.md)** — orientation any agent should read first: where things live, the
  hard constraints that shape the app (secrets are write-only, no server-side database), and the
  project's conventions.
- **[`docs/`](./docs/)** — `Architecture.md` and `CodingStandards.md`, described above. Written to
  be read by both humans and agents.
- **Four project agents** under [`.claude/agents/`](./.claude/agents/), named after Justice League
  members:
  - **Batman** — the planner, codebase authority, and documentation owner. Read-only for source
    code (produces plans, explains how things work) but is the only agent with write access to
    documentation — after a feature/fix/UI change lands, Batman is invoked again to bring every
    affected doc (this README, `CLAUDE.md`, `docs/*.md`, every folder `README.md`) in sync with
    what actually got built, rather than leaving that to whichever agent happened to implement it.
  - **Superman** — implements features end-to-end, following this project's conventions; works from
    Batman's findings rather than exploring cold.
  - **Flash** — diagnoses and fixes bugs with the smallest correct change; also works from Batman's
    findings for anything non-trivial.
  - **Green Lantern** — builds and reshapes the UI: component templates/styles, layout,
    responsiveness, accessibility, visual polish. Doesn't make business/API decisions (those belong
    to `api/`, per the constraint above) — a UI task that turns out to need one gets flagged back
    rather than faked client-side.

  All four treat a shared task board as a live status channel while they work — not just a
  todo list — so what an agent is doing is visible before it finishes, not only in its final
  report (see `CLAUDE.md`'s "How agents share progress while working" for the exact convention).

  These are plain project-level configuration (`.claude/agents/*.md`), not tied to any one
  interface — they work identically regardless of how Claude Code is invoked: the CLI directly,
  the **Claude Code VS Code extension**, the **Claude Code JetBrains plugin** (IntelliJ, WebStorm,
  Rider, Android Studio, …), or the CLI run from **Visual Studio**'s integrated terminal (Visual
  Studio — the full IDE, not VS Code — doesn't have its own native Claude Code extension; running
  the CLI from its terminal gets the identical experience since it's the same underlying tool).
  No per-editor setup needed either way; cloning the repo is enough.

## History

This app was originally built in React; it was later ported to Angular. The original
implementation and the full port record are kept at [`archive/`](./archive/) for reference —
neither is required reading for working on the app today.
