import { Component, ElementRef, ViewChild, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';
export type ButtonType = 'button' | 'submit';

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 rounded-md font-sans text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4',
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand/90',
  secondary: 'bg-ink text-text border border-line hover:border-text-dim',
  ghost: 'text-text-dim hover:text-text hover:bg-panel-raised',
  danger: 'bg-danger-dim text-danger border border-danger/30 hover:bg-danger/15',
};

/**
 * Port of web/src/components/Button.tsx. Consumers bind `(click)` directly on `<app-button>` —
 * a native DOM click on the inner <button> bubbles up through this component's host element
 * like any other nested element, so no separate output is needed just to forward clicks.
 */
@Component({
  selector: 'app-button',
  templateUrl: './Button.component.html',
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('md');
  readonly type = input<ButtonType>('button');
  readonly disabled = input(false);
  /** Extra utility classes appended after the variant/size classes — same role as React's `className` prop. */
  readonly extraClass = input('');

  protected readonly classes = computed(
    () => `${BASE_CLASSES} ${SIZE_CLASSES[this.size()]} ${VARIANT_CLASSES[this.variant()]} ${this.extraClass()}`.trim(),
  );

  @ViewChild('nativeButton') private readonly nativeButton?: ElementRef<HTMLButtonElement>;

  /** Used by ConfirmDialogComponent to autofocus the confirm button on open — direct successor
   * to the original's `useRef` + `forwardRef` autofocus wiring. */
  Focus(): void {
    this.nativeButton?.nativeElement.focus();
  }
}
