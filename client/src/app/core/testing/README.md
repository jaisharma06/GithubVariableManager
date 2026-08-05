# core/testing

Shared test infrastructure used by every spec in the workspace. Nothing here ships in the
production bundle — it's only ever imported from `*.spec.ts` files.

## Files

- **`TestDoubles.ts`** — one `CreateFake*Gateway()` factory per Gateway interface (returns a
  `jasmine.SpyObj`), plus:
  - `SeedFakeSession()` / `ClearFakeSession()` — write/remove a fake authenticated session
    (`{ token: 'test-token', method: 'pat', viewer: {...} }`) directly into `localStorage` under
    the same key `AuthService` reads (`ghvm.session`). **Any spec that renders a component
    depending, even transitively, on a query gated by `AuthService.token()` must call
    `SeedFakeSession()` in `beforeEach` and `ClearFakeSession()` in `afterEach`** — without it,
    every `enabled: !!token && ...` guard is `false` and the query never runs at all. A missing
    `SeedFakeSession()` call doesn't fail loudly; it just leaves the UI stuck in its
    empty/loading/"no data" state, which can look like a passing test for the wrong reason (see
    the `WaitFor` note below).
  - `ProvideTestQueryClient()` — an Angular `Provider` for a fresh `QueryClient` with
    `retry: false` (so failed-query tests don't hang retrying). Required by any spec that renders a
    component using `injectQuery`/`injectMutation`/`injectQueryClient`, i.e. anything depending on
    a Facade from `core/facades/`.

- **`WaitFor.ts`** — a real (non-fake-clock) polling helper:
  ```ts
  await WaitFor(fixture, () => !fixture.nativeElement.querySelector('.animate-pulse'));
  ```
  Repeatedly calls `fixture.detectChanges()` and checks a DOM-based condition every 10ms (real
  `setTimeout`, not `fakeAsync`'s virtual clock) until it's true or a 2s timeout elapses.

## Why `WaitFor` exists — TanStack Angular Query runs outside NgZone

This is the single most important, least obvious thing to know before writing a spec in this
workspace. `@tanstack/angular-query-experimental` deliberately runs its internal subscription/
notification machinery **outside NgZone** (via `runOutsideAngular`) to avoid triggering unnecessary
change detection on every cache event. The practical consequence:

- **`await fixture.whenStable()` cannot observe a query resolving.** It waits for the NgZone
  `onStable` event, which a query's data arriving does not trigger.
- **`fakeAsync()` + `tick()`/`flushMicrotasks()` cannot observe a query resolving either**, for the
  same reason — the fake zone never sees the out-of-zone microtask queue drain.
- Both of the above **can** observe a **mutation** resolving, because a mutation's
  `mutateAsync(...)` is directly `await`ed inside the component's own zone-tracked method (e.g.
  `RenameEnvironmentDialogComponent.HandleSubmit`) — the `await` itself is what re-enters the zone,
  not anything TanStack Query does specially for mutations.

This was diagnosed the hard way while writing `ScopePickerComponent`'s spec: the fake gateway *was*
being called (`calls.count() === 1`, confirmed via a temporary `console.log`), but the query's
`status()` signal stayed `'pending'` forever under every combination of `whenStable()`/`tick()`/
`flushMicrotasks()` tried. Switching to a real polling loop (`WaitFor`) fixed it immediately.

**The rule going forward:**
- Any assertion that depends on a **query** resolving → `await WaitFor(fixture, () => <condition>)`.
- Any assertion that depends on a **mutation** completing (a submitted form, a clicked delete
  button that calls `.mutateAsync()`) → wrap the test body in `fakeAsync(() => { ...; tick(); })`,
  calling `tick()` once per chained `await` in the mutation flow (e.g. three times for
  `RenameEnvironmentDialogComponent`'s create → copy → delete sequence).
- Don't guess which one a given assertion needs — check whether the data it's asserting on comes
  from an `injectQuery` or an `injectMutation` in the component under test.

`WaitFor`'s condition should be a DOM query, not a reference to a `protected` class member —
component fields under test (`loading`, `runners`, etc.) are `protected` precisely so templates and
child bindings can use them without exposing them as public API, which also makes them inaccessible
from a `.spec.ts` file outside the class. A DOM-based condition (e.g. "the loading skeleton is
gone", or "this specific button now exists") sidesteps that entirely and also tests what a user
would actually observe.

## Why `RenameEnvironmentDialogComponent` seeds `newName` in `ngOnInit`, not a field initializer

Documented here because it was found via a testing pattern, not app behavior: `TestBed
.createComponent()` + `fixture.componentRef.setInput(...)` — the standard way to set a
`input.required<T>()` in a spec — applies inputs **after** the constructor runs, unlike normal
template-driven component creation, where Angular applies input bindings before the constructor
body executes. A field initializer that reads a required input (`signal(this.oldName())`) throws
`NG0950: Input is required but no value is available yet` under the `setInput()` path. Any new
component with a required input that needs deriving into a signal at construction time should seed
that signal in `ngOnInit()`, not a field initializer, to stay safe under both creation paths.
