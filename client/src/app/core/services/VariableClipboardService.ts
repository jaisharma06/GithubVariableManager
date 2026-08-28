import { Injectable, signal } from '@angular/core';

export interface ClipboardVariable {
  name: string;
  value: string;
}

/**
 * App-wide "copy a variable, paste it anywhere" buffer — ambient client-only UI state, same tier
 * as `LastScopeService`/`RateLimitService` (singleton via DI, no Gateway dependency, never talks
 * to `api/`). Deliberately variable-only: secret values are write-only at the GitHub API level, so
 * there's never a value to put in this buffer for a secret row (see `docs/Architecture.md`'s
 * "secrets are write-only" section).
 *
 * The buffer persists until the next `CopyVariable` call overwrites it — no auto-clear on paste or
 * sign-out, matching this feature's product decision (a paste doesn't consume the buffer, since a
 * user copying one value into several scopes in a row is the common case).
 */
@Injectable({ providedIn: 'root' })
export class VariableClipboardService {
  private readonly clipboardSignal = signal<ClipboardVariable | null>(null);

  readonly clipboard = this.clipboardSignal.asReadonly();

  /**
   * Records `{ name, value }` in the in-app buffer and best-effort mirrors the raw value only
   * (never `NAME=value`) to the OS clipboard. `navigator.clipboard.writeText` can reject (no
   * permission, insecure context, unsupported browser) — that failure must never propagate to the
   * caller, since the in-app buffer (what actually powers paste) is set either way.
   */
  CopyVariable(name: string, value: string): void {
    this.clipboardSignal.set({ name, value });
    try {
      // Swallow a rejected write (no permission, insecure context) — best-effort mirror only.
      void navigator.clipboard?.writeText(value)?.catch(() => undefined);
    } catch {
      // Best-effort only — e.g. no clipboard permission or an insecure context.
    }
  }
}
