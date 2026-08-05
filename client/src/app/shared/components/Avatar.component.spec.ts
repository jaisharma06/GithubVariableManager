import { TestBed } from '@angular/core/testing';
import { AvatarComponent } from './Avatar.component';

describe('AvatarComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AvatarComponent] }).compileComponents();
  });

  it('shows the first-letter initial when there is no avatarUrl', () => {
    const fixture = TestBed.createComponent(AvatarComponent);
    fixture.componentRef.setInput('login', 'octocat');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('O');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
  });

  it('renders an <img> (kept hidden until it loads) when avatarUrl is set', () => {
    const fixture = TestBed.createComponent(AvatarComponent);
    fixture.componentRef.setInput('login', 'octocat');
    fixture.componentRef.setInput('avatarUrl', 'https://example.com/avatar.png');
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.classList.contains('hidden')).toBe(true);
  });

  it('falls back to the initial if the image errors', () => {
    const fixture = TestBed.createComponent(AvatarComponent);
    fixture.componentRef.setInput('login', 'octocat');
    fixture.componentRef.setInput('avatarUrl', 'https://example.com/avatar.png');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('img') as HTMLImageElement).dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('O');
  });
});
