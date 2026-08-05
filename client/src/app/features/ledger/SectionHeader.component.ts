import { Component, computed, input, output } from '@angular/core';
import type { ItemLevel } from '../../core/Types';

const LEVEL_LABEL: Record<ItemLevel, string> = {
  organization: 'Organization',
  repository: 'Repository',
  environment: 'Environment',
};

/** Port of web/src/features/ledger/SectionHeader.tsx. */
@Component({
  selector: 'app-section-header',
  templateUrl: './SectionHeader.component.html',
})
export class SectionHeaderComponent {
  readonly level = input.required<ItemLevel>();
  readonly scopeLabel = input.required<string>();
  readonly description = input.required<string>();

  readonly add = output<void>();

  protected readonly levelLabel = computed(() => LEVEL_LABEL[this.level()]);
}
