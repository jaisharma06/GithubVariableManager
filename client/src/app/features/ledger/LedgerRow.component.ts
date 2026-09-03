import { Component, computed, inject, input, output } from '@angular/core';
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
  /** Sync — re-reads the formula from this scope's manifest and overwrites the real value with today's resolved literal, via `POST /api/ledger/variables/sync`. Composite variables only; see Ledger.component.ts/DashboardShellComponent for the confirm-dialog + mutation this bubbles up to. Replaces the old "flatten to literal" action 1:1 — the formula itself always survives a sync, it's never a one-way trip. */
  readonly syncItem = output<void>();

  private readonly variableClipboardService = inject(VariableClipboardService);

  protected readonly rowGrid = ROW_GRID;
  protected readonly isSecret = computed(() => this.item().kind === 'secret');
  protected readonly masked = computed(() => this.isSecret() || this.hideValues());
  protected readonly railClass = computed(() => (this.isSecret() ? 'bg-secret' : 'bg-variable'));

  /**
   * Manifest-driven now, not value-pattern-driven: presence of a formula (tracked server-side in
   * this scope's hidden manifest variable, `api/Services/CompositeManifestService.cs`) is the ONLY
   * thing that makes an item composite — `item().value` (the real, already-resolved GitHub literal)
   * is never consulted for this anymore. Variables only — a secret's value gets no composite UI at all.
   */
  protected readonly isComposite = computed(() => this.item().formula !== undefined);
  protected readonly hasUnresolvedReferences = computed(() => (this.item().unresolvedReferences?.length ?? 0) > 0);
  /**
   * `resolvedValue` is recomputed fresh on every read against CURRENT sibling values — it differing
   * from the real, already-stored `value` means a dependency changed since this item's last
   * create/update/sync: the value shown is correct-as-of-last-sync, but stale relative to right now.
   */
  protected readonly isStale = computed(() => {
    const item = this.item();
    return this.isComposite() && item.resolvedValue !== undefined && item.resolvedValue !== item.value;
  });
  /**
   * Unconditionally available for any composite — Sync is the routine recovery action now,
   * including for a currently-broken/circular formula (clicking Sync just surfaces the server's
   * existing circular error in the confirm dialog, same as any other sync failure). No more "only
   * if resolvedValue is defined" gate — that gate belonged to the old flatten-to-literal design.
   */
  protected readonly canSync = computed(() => this.isComposite());

  /** Variable-only, mirroring CopyItemDialogComponent's rule that a secret's value can never be silently carried over. */
  protected HandleCopyValue(): void {
    const item = this.item();
    if (item.kind !== 'variable') return;
    this.variableClipboardService.CopyVariable(item.name, item.value ?? '');
  }
}
