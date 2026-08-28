import { Component, computed, inject, input, output } from '@angular/core';
import { VariableClipboardService } from '../../core/services/VariableClipboardService';
import type { ItemLevel } from '../../core/Types';

const LEVEL_LABEL: Record<ItemLevel, string> = {
  organization: 'Organization',
  repository: 'Repository',
  environment: 'Environment',
};

/**
 * Port of web/src/features/ledger/SectionHeader.tsx. Injects VariableClipboardService directly
 * (ambient UI convenience state, not Facade-mediated) to decide whether to show/enable "Paste
 * variable" — mirrors ScopeSidebarComponent injecting EnvironmentsFacade directly rather than
 * round-tripping this through outputs.
 */
@Component({
  selector: 'app-section-header',
  templateUrl: './SectionHeader.component.html',
})
export class SectionHeaderComponent {
  readonly level = input.required<ItemLevel>();
  readonly scopeLabel = input.required<string>();
  readonly description = input.required<string>();

  readonly add = output<void>();
  readonly pasteVariable = output<void>();

  private readonly variableClipboardService = inject(VariableClipboardService);

  protected readonly levelLabel = computed(() => LEVEL_LABEL[this.level()]);
  protected readonly hasClipboard = computed(() => this.variableClipboardService.clipboard() !== null);
  /** Named in the "Paste" button's tooltip so it reads as "paste what I copied", not a generic action. */
  protected readonly clipboardName = computed(() => this.variableClipboardService.clipboard()?.name ?? null);
}
