import { TestBed } from '@angular/core/testing';
import { RateLimitService } from '../../core/services/RateLimitService';
import { RateLimitIndicatorComponent } from './RateLimitIndicator.component';

describe('RateLimitIndicatorComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RateLimitIndicatorComponent] }).compileComponents();
  });

  it('renders nothing before any rate-limit info has been seen', () => {
    const fixture = TestBed.createComponent(RateLimitIndicatorComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('renders the remaining/limit once RateLimitService has data', () => {
    const fixture = TestBed.createComponent(RateLimitIndicatorComponent);
    const rateLimitService = TestBed.inject(RateLimitService);
    rateLimitService.SetRateLimit({ remaining: 4990, limit: 5000, resetAt: null });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('4990/5000 API calls left');
  });
});
