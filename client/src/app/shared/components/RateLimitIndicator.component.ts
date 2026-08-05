import { Component, computed, inject } from '@angular/core';
import { RateLimitService } from '../../core/services/RateLimitService';

/** Port of web/src/components/RateLimitIndicator.tsx. */
@Component({
  selector: 'app-rate-limit-indicator',
  templateUrl: './RateLimitIndicator.component.html',
})
export class RateLimitIndicatorComponent {
  private readonly rateLimitService = inject(RateLimitService);

  protected readonly rateLimit = this.rateLimitService.state;

  protected readonly low = computed(() => {
    const info = this.rateLimit();
    return info ? info.remaining < info.limit * 0.1 : false;
  });

  protected readonly resetLabel = computed(() => {
    const resetAt = this.rateLimit()?.resetAt;
    return resetAt ? new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  });

  protected readonly titleText = computed(() => (this.resetLabel() ? `Resets ${this.resetLabel()}` : null));
}
