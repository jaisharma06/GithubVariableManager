import { Injectable, computed, inject, signal } from '@angular/core';
import { SCOPES_GATEWAY, type IScopesGateway } from '../gateways/IScopesGateway';
import type { Viewer } from '../Types';

export type AuthMethod = 'pat' | 'oauth';

interface StoredSession {
  token: string;
  method: AuthMethod;
  viewer: Viewer;
}

// localStorage (not sessionStorage) so the session survives closing the tab/browser — the user
// stays signed in until they disconnect or GitHub rejects the token.
const STORAGE_KEY = 'ghvm.session';

/**
 * Port of web/src/auth/AuthContext.tsx, with web/src/lib/authEvents.ts folded in: the React app
 * hand-rolls a module-level pub/sub purely so `api/client.ts` (outside any component) can notify
 * AuthContext of a 401 without a direct import cycle. Angular doesn't need that indirection —
 * AuthInterceptor just injects this service directly and calls SignOut() on a 401.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly scopesGateway = inject<IScopesGateway>(SCOPES_GATEWAY);
  private readonly sessionSignal = signal<StoredSession | null>(ReadStoredSession());

  readonly token = computed(() => this.sessionSignal()?.token ?? null);
  readonly method = computed(() => this.sessionSignal()?.method ?? null);
  readonly viewer = computed(() => this.sessionSignal()?.viewer ?? null);

  constructor() {
    // Keep multiple tabs in sync: signing out (or in) in one tab reflects in the others, since
    // they now share the same localStorage-backed session.
    window.addEventListener('storage', this.HandleStorageEvent);
  }

  async ConnectWithToken(token: string, method: AuthMethod = 'pat'): Promise<void> {
    const viewer = await this.scopesGateway.GetViewer(token);
    const next: StoredSession = { token, method, viewer };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.sessionSignal.set(next);
  }

  // Deliberately navigation-free — every caller (ScopePickerComponent, DashboardShellComponent,
  // AuthInterceptor) is responsible for navigating to '/connect' itself after calling this.
  SignOut(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.sessionSignal.set(null);
  }

  private readonly HandleStorageEvent = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY) return;
    try {
      this.sessionSignal.set(event.newValue ? (JSON.parse(event.newValue) as StoredSession) : null);
    } catch {
      this.sessionSignal.set(null);
    }
  };
}

function ReadStoredSession(): StoredSession | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}
