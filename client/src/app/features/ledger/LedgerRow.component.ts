import { Component, computed, input, output } from '@angular/core';
import type { LedgerItem } from '../../core/Types';

/**
 * Shared grid template columns — rail / type / name / value / access / actions. Exported so
 * Ledger.component.html can reuse the exact same column layout for its header row and its inline
 * locked-row markup (the locked-row variant has no interactivity and only ever appears there, so
 * unlike this component it isn't split into its own file).
 */
export const ROW_GRID = 'grid grid-cols-[3px_3rem_1fr_1fr_5rem_6.5rem] items-center';

/** Port of web/src/features/ledger/LedgerRow.tsx's LedgerRow. */
@Component({
  selector: 'app-ledger-row',
  templateUrl: './LedgerRow.component.html',
})
export class LedgerRowComponent {
  readonly item = input.required<LedgerItem>();
  readonly hideValues = input(false);

  readonly editItem = output<void>();
  readonly copyItem = output<void>();
  readonly deleteItem = output<void>();

  protected readonly rowGrid = ROW_GRID;
  protected readonly isSecret = computed(() => this.item().kind === 'secret');
  protected readonly masked = computed(() => this.isSecret() || this.hideValues());
  protected readonly railClass = computed(() => (this.isSecret() ? 'bg-secret' : 'bg-variable'));
}
