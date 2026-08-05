import { Component, computed, input } from '@angular/core';
import type { ItemKind } from '../../core/Types';

const KIND_STYLES: Record<ItemKind, string> = {
  variable: 'bg-variable-dim text-variable',
  secret: 'bg-secret-dim text-secret',
};

const KIND_LABELS: Record<ItemKind, string> = {
  variable: 'VAR',
  secret: 'SEC',
};

/** Port of web/src/components/Badge.tsx's KindBadge. */
@Component({
  selector: 'app-kind-badge',
  templateUrl: './KindBadge.component.html',
})
export class KindBadgeComponent {
  readonly kind = input.required<ItemKind>();

  protected readonly classes = computed(
    () =>
      `inline-flex w-10 shrink-0 items-center justify-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide ${KIND_STYLES[this.kind()]}`,
  );
  protected readonly label = computed(() => KIND_LABELS[this.kind()]);
}
