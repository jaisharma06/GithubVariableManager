# Coding Standards

These rules govern all new code in `client/` (the Angular UI) and `api/` (the ASP.NET Core
backend). Agents and contributors should treat this file as the source of truth for "how do we
write code here", ahead of framework defaults. (The archived `archive/web/` React app isn't
actively maintained and doesn't need to follow these — see `archive/web/README.md`.)

## Naming convention (explicit project decision)

- **File names: PascalCase.** e.g. `ItemEditorPanel.component.ts`, `AuthService.ts`,
  `BackendLedgerGateway.service.ts`.
- **Method names: PascalCase.** e.g. `HandleSubmit()`, `LoadLedger()`, `CopyToScopes()`.
- **Variable and property names: camelCase.** e.g. `isLoading`, `itemName`, `selectedScopes`.

> **Note for Angular specifically:** this **intentionally deviates** from Angular's official style
> guide, which defaults to kebab-case file names (`item-editor-panel.component.ts`) and camelCase
> methods. That's a deliberate, explicit choice for this project — apply it consistently rather
> than falling back to Angular CLI defaults. The one exception is Angular's required lowercase
> type-suffix (`.component.ts`, `.service.ts`, `.guard.ts`, …) — that suffix is tooling metadata
> for schematics/build tooling, not "the name", so it stays lowercase even though the name segment
> before it is PascalCase. Enforced via `@angular-eslint` naming-convention rules
> (`eslint.config.js`), not just documented and hoped for — run `npm run lint` (or `ng lint`) and
> it will fail loudly on a violation.

> **Note for `api/` (C#) specifically:** C#'s idiomatic method-naming convention (PascalCase)
> already matches this project's method-naming rule with zero adaptation — `Classify()`,
> `GetToken()`, not `classify()`/`getToken()`. File names follow the same PascalCase rule as
> `client/` (e.g. `PermissionErrorClassifier.cs`, `HttpContextBearerTokenAccessor.cs`), matching
> C#'s own one-type-per-file-named-after-the-type convention. The one place this project's
> "variables/properties: camelCase" rule doesn't map onto C# cleanly is **public properties** —
> idiomatic C# uses PascalCase there (`public bool Locked { get; }`). Treat that as a second,
> language-idiomatic exception parallel to the already-documented `.component.ts` suffix exception:
> **public C# properties stay PascalCase**; private fields and local variables stay camelCase,
> matching this project's variables rule as closely as the language allows. This isn't a loophole —
> ASP.NET Core's default JSON serialization (`JsonSerializerDefaults.Web`) already converts
> PascalCase C# properties to camelCase on the wire, so a contract like
> `GitHubPermissionError(bool Locked, int Status, string Message)` still produces
> `{ locked, status, message }` for `client/` to consume, with no manual mapping needed.

> **Note on GitHub resource id fields (`api/`, C#):** always type a raw GitHub resource id `long`,
> never `int`. GitHub's id space is shared across resource types and keeps growing over time, so
> even a low-population resource type can already exceed `Int32.MaxValue` — a real environment id
> did, causing a live `System.OverflowException` (a `500` on `GET /api/ledger`) when
> `RawEnvironment.Id`/`EnvironmentResponse.Id` were declared `int`; both are now `long` (see
> `GitHub/RawActionsModels.cs` / `Contracts/LedgerContracts.cs`). Every other GitHub-resource-id
> field in this backend already follows this (`RepoResponse.Id`, `WorkflowResponse.Id`,
> `RunnerResponse.Id`, …).

## SOLID, applied to this codebase

- **Single Responsibility** — a module does one job. Gateways (`core/gateways/`) only do HTTP;
  Facades (`core/facades/`) only orchestrate state; feature components only render and collect
  input.
- **Open/Closed** — extend by adding, not by editing every call site. Example already in this
  repo: adding the Compare view's bulk operations (`CopyFacade`, `DeleteEverywhereFacade`) didn't
  touch any existing single-item mutation in `ItemMutationsFacade` — it composed them. A new
  GitHub resource gets a new Gateway interface + implementation, with nothing existing edited.
- **Liskov Substitution** — anything implementing a shared interface must be fully swappable for
  another implementation without surprising callers. Every Gateway implementation must satisfy its
  interface fully — this is what made the ASP.NET Core migration a safe drop-in, vertical by
  vertical.
- **Interface Segregation** — prefer several narrow interfaces over one broad one.
  `IVariablesGateway` / `ISecretsGateway` / `IEnvironmentsGateway` / `IRunnersGateway` /
  `IScopesGateway` are separated by resource rather than one `IGithubApi` covering everything.
- **Dependency Inversion** — depend on abstractions, not concrete implementations. Facades and
  Components inject `InjectionToken`s for Gateway interfaces, never `HttpClient` directly and never
  a concrete `Backend*Gateway`. This is also exactly what made the ASP.NET Core swap low-risk —
  swap the provider, not the consumers.

## Design patterns — use deliberately, not decoratively

Every pattern used in this project should trace back to a real problem it solves here — see
[`Architecture.md`](./Architecture.md#design-patterns-in-use) for the full list with justification
tied to specific files. Don't add a pattern "because it's best practice" — add it because a
concrete, named problem (stated in a comment or PR description) needs it. When in doubt, prefer
the simplest thing that works (a plain function/service) over introducing a pattern pre-emptively.
Two examples already in this codebase of a pattern being deliberately **not** added: a full NgRx
store was considered and rejected for state management (TanStack Angular Query already covers this
app's actual needs — see `Architecture.md`); a `Strategy` pattern for `variable`/`secret`
branching was considered and rejected too (the branching stayed shallow enough that a handful of
inline ternaries reads better than a class hierarchy — see `core/strategies/README.md`).

## Modularity & coupling

- **Business/API decision logic belongs in `api/`; `client/` only renders and reflects
  already-decided state.** This is the completed end-state of the ASP.NET Core migration (see
  `docs/Architecture.md`) — orchestration that used to live in an Angular Facade (batch fan-out,
  permission-error classification, multi-step sequences) now lives in an `api/Services/*Service.cs`
  for every resource. Don't add new orchestration/business logic to a `client/` Facade — extend the
  backend Service instead.
- **Feature folders are self-contained.** A feature (`ledger/`, `compare/`, `item-editor/`, …)
  should be understandable by reading only its own folder plus the shared `core/`/`shared/`
  layers it depends on — never another feature folder directly. Cross-feature reuse goes through
  `shared/components/` (presentational) or `core/facades/` (state), never a direct import from one
  feature into another.
- **Components don't know about transport.** No feature component should construct a GitHub URL,
  set an HTTP header, or catch a raw HTTP error shape — that's the `core/gateways/` layer's job.
  This is what let the transport layer be swapped (direct-to-GitHub, then via the ASP.NET Core
  backend) without touching a single component.
- **One concern per file.** If a file's top-of-file comment needs "and" to describe its job, it
  should probably be two files.

## Readability

- Prefer explicit, boring code over clever code. This codebase favors small named helper functions
  and early returns over deeply nested conditionals or one-line "clever" expressions.
- A non-obvious *why* gets a comment; an obvious *what* doesn't. Match the density already in the
  codebase — most files have a handful of comments explaining constraints (e.g. "GitHub never
  returns a secret's value"), not line-by-line narration.
- Keep names literal. `DeleteEverywhereFacade`, `CopyItemDialogComponent`, `lockTarget` — a reader
  shouldn't need to open the file to guess what something does.

## Verification expectations

Before considering a change done:
- `ng build` (dev config) and `ng build --configuration production` both clean.
- `ng lint` clean.
- `ng test --watch=false --browsers=ChromeHeadless` green.
- New behavior checked against the feature list in the root [`README.md`](../README.md) so nothing
  regresses.
- `dotnet build` clean for `api/GithubVariablesManager.Api.sln`.
- `dotnet test` green for `api/tests/GithubVariablesManager.Api.Tests`.
