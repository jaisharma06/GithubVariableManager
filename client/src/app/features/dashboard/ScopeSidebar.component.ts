import { Component, ElementRef, Injector, ViewChild, afterNextRender, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EnvironmentsFacade } from '../../core/facades/EnvironmentsFacade';
import type { GithubEnvironment } from '../../core/Types';
import type { LedgerFilters } from '../ledger/LedgerFilters';

export interface ScopeNavigateEvent {
  level: LedgerFilters['level'];
  env?: string;
}

/**
 * Port of web/src/features/dashboard/ScopeSidebar.tsx. `onNavigate`/`onRenameEnvironment`/
 * `onDeleteEnvironment` stay callback-shaped (outputs) — DashboardShellComponent owns what
 * happens next (updating filters, opening a dialog). `onCreateEnvironment` doesn't: the original
 * is `(name: string) => Promise<void>`, awaited directly by the form so it can show its own
 * error and reset itself — an Angular `output()` can't hand a promise back to its emitter, so
 * this component injects EnvironmentsFacade directly and drives that flow itself instead of
 * routing it through the parent.
 */
@Component({
  selector: 'app-scope-sidebar',
  imports: [RouterLink],
  templateUrl: './ScopeSidebar.component.html',
})
export class ScopeSidebarComponent {
  readonly org = input.required<string>();
  readonly repo = input<string | undefined>(undefined);
  readonly environments = input<GithubEnvironment[]>([]);
  readonly showOrgLevel = input(false);
  readonly filters = input.required<LedgerFilters>();

  readonly navigate = output<ScopeNavigateEvent>();
  readonly renameEnvironment = output<string>();
  readonly deleteEnvironment = output<string>();

  private readonly environmentsFacade = inject(EnvironmentsFacade);
  private readonly injector = inject(Injector);

  protected readonly newEnvOpen = signal(false);
  protected readonly newEnvName = signal('');
  protected readonly newEnvError = signal<string | null>(null);
  protected readonly newEnvSubmitting = signal(false);

  // The field only exists in the DOM once newEnvOpen() is true, so — unlike ScopePickerComponent's
  // always-present search input — this can't just focus once in ngAfterViewInit. Focused
  // programmatically (not via the `autofocus` attribute — see ScopePickerComponent's doc comment)
  // right after the form's next render each time it opens.
  @ViewChild('newEnvInput') private readonly newEnvInput?: ElementRef<HTMLInputElement>;

  protected TreeItemClasses(active: boolean): string {
    return `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
      active ? 'bg-brand-dim font-medium text-brand' : 'text-text-dim hover:bg-panel-raised hover:text-text'
    }`;
  }

  protected EnvironmentRowClasses(active: boolean): string {
    return `group flex items-center rounded-md transition-colors ${active ? 'bg-brand-dim' : 'hover:bg-panel-raised'}`;
  }

  protected EnvironmentLabelClasses(active: boolean): string {
    return `flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm ${
      active ? 'font-medium text-brand' : 'text-text-dim group-hover:text-text'
    }`;
  }

  protected OpenNewEnvForm(): void {
    this.newEnvOpen.set(true);
    afterNextRender(() => this.newEnvInput?.nativeElement.focus(), { injector: this.injector });
  }

  protected CloseNewEnvForm(): void {
    this.newEnvOpen.set(false);
    this.newEnvName.set('');
    this.newEnvError.set(null);
  }

  protected HandleNewEnvNameInput(event: Event): void {
    this.newEnvName.set((event.target as HTMLInputElement).value);
  }

  protected HandleNewEnvKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.CloseNewEnvForm();
  }

  protected async HandleCreateEnvironment(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.newEnvName().trim();
    const repo = this.repo();
    if (!name || !repo) return;

    this.newEnvSubmitting.set(true);
    this.newEnvError.set(null);
    try {
      await this.environmentsFacade.createEnvironment.mutateAsync({ org: this.org(), repo, name });
      this.CloseNewEnvForm();
    } catch (err) {
      this.newEnvError.set(err instanceof Error ? err.message : 'GitHub rejected this request.');
    } finally {
      this.newEnvSubmitting.set(false);
    }
  }
}
