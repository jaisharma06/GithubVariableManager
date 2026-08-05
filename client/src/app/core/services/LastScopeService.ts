import { Injectable } from '@angular/core';

export interface LastScope {
  path: string;
  label: string;
}

const STORAGE_KEY = 'ghvm.lastScope';

/** Port of web/src/lib/lastScope.ts. Deliberately sessionStorage, not localStorage — unlike the
 * auth session, "the last scope you looked at" shouldn't survive a fresh browser restart. */
@Injectable({ providedIn: 'root' })
export class LastScopeService {
  SetLastScope(scope: LastScope): void {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(scope));
  }

  GetLastScope(): LastScope | null {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LastScope;
    } catch {
      return null;
    }
  }
}
