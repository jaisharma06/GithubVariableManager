# GitHub Variables Manager

A single, unified view of every GitHub Actions **variable** and **secret** you have access to — organization, repository, and environment levels together — instead of clicking through a different GitHub settings screen for each one.

![status](https://img.shields.io/badge/status-internal--tool-blue) ![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Why this exists

Managing GitHub Actions configuration is tedious by default: variables and secrets live at three different levels (organization, repository, environment), and GitHub gives each level × type combination its own settings page. Checking or changing a handful of values across a repo and its environments means half a dozen page loads and just as many clicks.

This tool connects to GitHub with your own credentials and gives you one filterable, searchable list of everything in scope — with the ability to create, edit, and delete variables and secrets without leaving the page.

**One real constraint shapes the UI, by design:** GitHub's API can return a *variable's* value, but it can **never** return a *secret's* value — secrets are write-only, encrypted client-side and never sent back by GitHub, at any level. This app is honest about that: variable values are visible (with a one-click "hide all" toggle before you screen-share), secret rows always show a locked, write-only state instead of a broken "reveal" button that could never work.

## Features

- **One login, everything in scope** — pick an organization or a repository and see its organization-level, repository-level, and every environment's variables/secrets in one place.
- **Two ways to connect** — a GitHub personal access token, or a real "Continue with GitHub" sign-in (OAuth device flow) — your choice.
- **Filter and search** — by level (organization / repository / environment), by type (variable / secret), by environment, or by name.
- **Create, edit, delete** — right from the list, with a level- and environment-aware form. Adding from inside a section pre-fills where the new item belongs.
- **Org-secret visibility control** — choose whether a new organization secret is available to all repos, private repos only, or a hand-picked selection.
- **Honest about secrets** — secret values are never fetched or displayed, because GitHub doesn't allow it; the UI explains why instead of pretending otherwise.
- **Nothing persisted server-side** — no database, and your token lives only in the browser tab's session storage.

## How it's built

- **`web/`** — the actual application: React 19 + TypeScript + Vite, Tailwind CSS, TanStack Query for data fetching/caching. Talks to `api.github.com` **directly from the browser** — GitHub's REST API supports CORS for authenticated requests, so there's no proxy for normal usage.
- **`server/`** — a minimal Express server with exactly one job: relaying two OAuth *device flow* calls. `github.com`'s OAuth endpoints (unlike `api.github.com`) don't support CORS, so those two calls can't be made directly from the browser. Nothing else runs through this server — it never sees your GitHub token, and (unlike a classic OAuth setup) it doesn't hold a client secret either, since the device flow doesn't use one.

```
┌──────────────┐   GitHub REST API (variables, secrets, repos…)   ┌──────────────┐
│   web (SPA)  │ ───────────────────────────────────────────────▶ │  api.github  │
│  :5173       │                                                  │  .com        │
│              │   device-flow code/token relay only              └──────────────┘
│              │ ───────────────────────┐
└──────────────┘                        ▼
                                  ┌──────────────┐        ┌──────────────┐
                                  │ server :8787 │ ─────▶  │ github.com   │
                                  └──────────────┘        │ (OAuth)      │
                                                           └──────────────┘
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later, and npm
- A GitHub account with access to the org/repo(s) you want to manage

## Setup

### 1. Install dependencies

From the repository root (this is an npm workspace — one install covers both `web` and `server`):

```bash
npm install
```

### 2. Configure the server

```bash
cp server/.env.example server/.env
```

The defaults work as-is — no further configuration needed. Both login options (personal access token and "Continue with GitHub") work out of the box: the OAuth **Client ID** is baked into the server as a default, so there's nothing to register or paste in just to get started. (A client ID isn't sensitive — unlike a client secret, it's meant to be public, which is exactly why the device flow doesn't need a secret in the first place.)

### 3. (Optional) Use your own OAuth App instead

If you'd rather have sign-in go through an OAuth App you control instead of the built-in default:

1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**.
2. Fill in any name/homepage URL you like — the callback URL field doesn't matter, it's not used.
3. After creating it, open the app's settings and **enable "Device Flow"**. This is required — without it, sign-in will fail.
4. Copy the **Client ID** into `server/.env`, overriding the default:
   ```
   GITHUB_OAUTH_CLIENT_ID=your_client_id_here
   ```
   No client secret is needed either way — the device flow never uses one.

### 4. (Optional) Configure the frontend

Only needed if you change the server's port:

```bash
cp web/.env.example web/.env
```

### 5. Run it

From the repository root:

```bash
npm run dev
```

This starts both processes together:

| Service | URL | Purpose |
|---|---|---|
| Web app | http://localhost:5173 | The application UI |
| Server | http://localhost:8787 | OAuth device-flow relay only |

Open **http://localhost:5173** in your browser.

To run them individually: `npm run dev:web` or `npm run dev:server`.

## Using the app

### Connect

You'll land on a connect screen with two tabs:

- **Personal access token** — paste a token and click Connect. It needs the `repo` and `admin:org` scopes (classic token), or the equivalent **Variables** and **Secrets** permissions at both repository and organization level (fine-grained token), to read and write at every level. The token is held only in the current tab's session storage — it's never written to disk and never sent anywhere except `api.github.com`.
- **GitHub OAuth** — click Continue with GitHub, enter the short code shown at `github.com/login/device`, approve it, and you're in. Works immediately, no setup required.

### Pick a scope

Search and select either an **organization** (shows its org-level variables/secrets) or a **repository** (shows that repo's organization, the repo itself, and every deployment environment on it — everything actually visible to that repo's Actions runs).

### Browse and manage

The ledger groups everything into sections by level, each with a plain-language description of what it means and its own "+ Add" button. Use the filter pills and search box to narrow things down. Toggle **Hide values** to mask every variable at once (handy before sharing your screen) — secret values are always hidden, since GitHub never returns them regardless.

Click a row's edit or delete icon to modify or remove it; deleting always asks for confirmation first.

## Project structure

```
GithubVariablesManager/
├── web/                        # React SPA — the application itself
│   └── src/
│       ├── api/                 # Typed GitHub REST client + React Query hooks
│       ├── auth/                 # PAT + OAuth device-flow auth
│       ├── features/
│       │   ├── scope-picker/     # Choose an org or repo
│       │   ├── dashboard/        # Screen shell around the ledger
│       │   ├── ledger/           # The main variables/secrets list
│       │   └── item-editor/      # Create/edit slide-over panel
│       ├── components/           # Shared UI primitives
│       └── lib/                  # Secret sealing (libsodium), rate-limit tracking
└── server/                     # Express — OAuth device-flow relay only, no database
    └── src/
        └── routes/auth.ts        # The two relayed endpoints
```

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS · TanStack Query · React Router · Express · libsodium-wrappers (client-side secret encryption, per GitHub's documented sealed-box scheme)

## Security notes

- Your GitHub token (PAT or OAuth) is held in `sessionStorage` in your browser only — it's cleared when the tab closes and is never written to disk or sent to the local server.
- Secret **values** are never read back from GitHub, by GitHub's own design — this app can set/update/delete a secret, but can never display its current value.
- The local server has no database and stores nothing between requests; it exists solely to work around `github.com`'s lack of CORS support for two OAuth endpoints.
- The default OAuth Client ID baked into the server is tied to one shared OAuth App — everyone using the default will see that app's name on GitHub's consent screen. That's fine for an internal team tool; if you're distributing this more broadly, register your own OAuth App (step 3 above) so consent screens reflect your own identity instead.
