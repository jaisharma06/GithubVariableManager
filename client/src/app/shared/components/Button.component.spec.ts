import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ButtonComponent } from './Button.component';

describe('ButtonComponent', () => {
  let fixture: ComponentFixture<ButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ButtonComponent] }).compileComponents();
    fixture = TestBed.createComponent(ButtonComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('defaults to a secondary, type="button" native button', () => {
    const nativeButton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(nativeButton.type).toBe('button');
    expect(nativeButton.className).toContain('bg-ink');
  });

  it('disables the native button when disabled is set', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const nativeButton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(nativeButton.disabled).toBe(true);
  });

  it('Focus() focuses the native button', () => {
    document.body.appendChild(fixture.nativeElement);
    fixture.componentInstance.Focus();
    const nativeButton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(document.activeElement).toBe(nativeButton);
    fixture.nativeElement.remove();
  });
});
