import { Injectable, signal } from '@angular/core';
import type { RateLimitInfo } from '../Types';

/**
 * Port of web/src/lib/rateLimitStore.ts. The original hand-rolls a pub/sub (a `Set` of listener
 * callbacks + `useSyncExternalStore`) purely because React has no built-in app-wide reactive
 * singleton primitive — Angular's DI (`providedIn: 'root'`) plus a signal gives the same
 * single-instance, reactively-observable state for free, no custom subscription plumbing needed.
 */
@Injectable({ providedIn: 'root' })
export class RateLimitService {
  private readonly stateSignal = signal<RateLimitInfo | null>(null);

  readonly state = this.stateSignal.asReadonly();

  SetRateLimit(info: RateLimitInfo): void {
    this.stateSignal.set(info);
  }
}
