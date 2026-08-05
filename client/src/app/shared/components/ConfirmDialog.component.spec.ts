import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmDialogComponent } from './ConfirmDialog.component';

describe('ConfirmDialogComponent', () => {
  let fixture: ComponentFixture<ConfirmDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ConfirmDialogComponent] }).compileComponents();
    fixture = TestBed.createComponent(ConfirmDialogComponent);
    fixture.componentRef.setInput('title', 'Delete this?');
    fixture.componentRef.setInput('confirmLabel', 'Delete');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('emits cancelled when Escape is pressed', () => {
    const cancelSpy = jasmine.createSpy('cancelled');
    fixture.componentInstance.cancelled.subscribe(cancelSpy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('emits confirmed when the confirm button is clicked', () => {
    const confirmSpy = jasmine.createSpy('confirmed');
    fixture.componentInstance.confirmed.subscribe(confirmSpy);
    const buttons = fixture.nativeElement.querySelectorAll('button');
    (buttons[buttons.length - 1] as HTMLButtonElement).click();
    expect(confirmSpy).toHaveBeenCalled();
  });
});
