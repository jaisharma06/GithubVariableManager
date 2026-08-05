import { TestBed } from '@angular/core/testing';
import { KindBadgeComponent } from './KindBadge.component';

describe('KindBadgeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [KindBadgeComponent] }).compileComponents();
  });

  it('shows VAR for a variable', () => {
    const fixture = TestBed.createComponent(KindBadgeComponent);
    fixture.componentRef.setInput('kind', 'variable');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('VAR');
  });

  it('shows SEC for a secret', () => {
    const fixture = TestBed.createComponent(KindBadgeComponent);
    fixture.componentRef.setInput('kind', 'secret');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('SEC');
  });
});
