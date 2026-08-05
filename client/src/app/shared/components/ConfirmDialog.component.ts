import { AfterViewInit, Component, HostListener, ViewChild, input, output } from '@angular/core';
import { ButtonComponent } from './Button.component';

/**
 * Port of web/src/components/ConfirmDialog.tsx. `description` (typed `ReactNode` in the
 * original — a plain string at most call sites, but a bullet list of affected scopes in
 * CompareView's delete-everywhere flow) becomes projected content via `<ng-content>`: callers
 * put whatever markup they need between this component's open/close tags instead of passing an
 * input.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [ButtonComponent],
  templateUrl: './ConfirmDialog.component.html',
})
export class ConfirmDialogComponent implements AfterViewInit {
  readonly title = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly error = input<string | null>(null);
  readonly confirming = input(false);

  // Past-tense, not `confirm`/`cancel` — `cancel` specifically collides with a real native DOM
  // event (HTMLDialogElement and <input type="file"> both dispatch one), which
  // @angular-eslint/no-output-native rightly flags as a footgun.
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  @ViewChild('confirmButton') private readonly confirmButton?: ButtonComponent;

  ngAfterViewInit(): void {
    this.confirmButton?.Focus();
  }

  @HostListener('document:keydown', ['$event'])
  protected HandleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancelled.emit();
  }
}
