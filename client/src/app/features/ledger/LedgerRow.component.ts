import { Component, computed, inject, input, output } from '@angular/core';
import { IsCompositeValue } from '../../core/facades/LedgerSupport';
import { VariableClipboardService } from '../../core/services/VariableClipboardService';
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
  /** "Flatten to literal" — overwrites the stored formula with today's resolved value, via the existing update-variable mutation. Composite variables only; see Ledger.component.ts/DashboardShellComponent for the confirm-dialog + mutation this bubbles up to. */
  readonly flattenItem = output<void>();

  private readonly variableClipboardService = inject(VariableClipboardService);

  protected readonly rowGrid = ROW_GRID;
  protected readonly isSecret = computed(() => this.item().kind === 'secret');
  protected readonly masked = computed(() => this.isSecret() || this.hideValues());
  protected readonly railClass = computed(() => (this.isSecret() ? 'bg-secret' : 'bg-variable'));

  /**
   * Azure-App-Config-style `$(OtherVarName)` composite variable — GitHub has no concept of this,
   * so "is composite" is always derived from the value itself, never a stored flag (see
   * `api/Services/CompositeVariableResolver.cs`'s doc comment for the full design this mirrors).
   * Variables only — a secret's value gets no composite UI at all.
   */
  protected readonly isComposite = computed(() => !this.isSecret() && this.item().value !== undefined && IsCompositeValue(this.item().value!));
  protected readonly hasUnresolvedReferences = computed(() => (this.item().unresolvedReferences?.length ?? 0) > 0);
  /** Nothing to flatten to when the formula is circular (LedgerService's read-time pass leaves resolvedValue undefined in that case) — the flatten action is hidden rather than offering a broken no-op. */
  protected readonly canFlatten = computed(() => this.isComposite() && this.item().resolvedValue !== undefined);

  /** Variable-only, mirroring CopyItemDialogComponent's rule that a secret's value can never be silently carried over. */
  protected HandleCopyValue(): void {
    const item = this.item();
    if (item.kind !== 'variable') return;
    this.variableClipboardService.CopyVariable(item.name, item.value ?? '');
  }
}
