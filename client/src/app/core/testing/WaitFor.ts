import type { ComponentFixture } from '@angular/core/testing';

/**
 * Polls a condition with real (not fakeAsync-simulated) delays, re-running change detection each
 * time, until it's true or a timeout elapses. TanStack Angular Query deliberately runs its
 * internal subscriptions outside NgZone (to avoid triggering change detection for every cache
 * event) — so neither `fixture.whenStable()` nor `fakeAsync`/`tick()`/`flushMicrotasks()` can see
 * that work as "pending", which makes both either hang or resolve with stale data. Real polling
 * sidesteps the question of which zone the work happens in entirely.
 */
export async function WaitFor(
  fixture: ComponentFixture<unknown>,
  check: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  fixture.detectChanges();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`WaitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();
  }
}
