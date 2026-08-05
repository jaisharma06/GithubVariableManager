import { AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, input, output, signal } from '@angular/core';
import { CopyFacade } from '../../core/facades/CopyFacade';
import { EnvironmentsFacade } from '../../core/facades/EnvironmentsFacade';
import type { GithubEnvironment, LedgerItem, ScopeRef } from '../../core/Types';
import { ButtonComponent } from '../../shared/components/Button.component';

export interface EnvironmentRenamedEvent {
  oldName: string;
  newName: string;
}

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Port of web/src/features/dashboard/RenameEnvironmentDialog.tsx. The new-name field is focused
 * programmatically in ngAfterViewInit rather than via `autofocus` — same reasoning as
 * ScopePickerComponent's doc comment.
 */
@Component({
  selector: 'app-rename-environment-dialog',
  imports: [ButtonComponent],
  templateUrl: './RenameEnvironmentDialog.component.html',
})
export class RenameEnvironmentDialogComponent implements OnInit, AfterViewInit {
  readonly org = input.required<string>();
  readonly repo = input.required<string>();
  readonly oldName = input.required<string>();
  readonly environments = input<GithubEnvironment[]>([]);
  /** The full ledger — used to find what's currently set in this environment. */
  readonly items = input<LedgerItem[]>([]);

  readonly closed = output<void>();
  readonly renamed = output<EnvironmentRenamedEvent>();

  private readonly environmentsFacade = inject(EnvironmentsFacade);
  private readonly copyFacade = inject(CopyFacade);

  @ViewChild('newNameInput') private readonly newNameInput?: ElementRef<HTMLInputElement>;

  // Seeded in ngOnInit, not a field initializer — required signal inputs are only guaranteed
  // available once Angular has actually applied bindings, which for template-created components
  // happens before the constructor runs, but for TestBed.createComponent() + setInput() (a
  // completely standard way to test a component) happens *after* — reading `oldName()` in a
  // field initializer throws NG0950 there. ngOnInit runs after inputs are set either way.
  protected readonly newName = signal('');

  ngOnInit(): void {
    this.newName.set(this.oldName());
  }

  ngAfterViewInit(): void {
    this.newNameInput?.nativeElement.focus();
  }

  protected readonly deleteOldAnyway = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly step = signal<'idle' | 'creating' | 'copying' | 'deleting'>('idle');

  protected readonly variables = computed(() =>
    this.items().filter((i) => i.kind === 'variable' && i.level === 'environment' && i.scope.env === this.oldName()),
  );
  protected readonly secrets = computed(() =>
    this.items().filter((i) => i.kind === 'secret' && i.level === 'environment' && i.scope.env === this.oldName()),
  );
  protected readonly secretNames = computed(() => this.secrets().map((s) => s.name).join(', '));

  protected readonly trimmed = computed(() => this.newName().trim());
  protected readonly nameValid = computed(() => this.trimmed().length === 0 || NAME_PATTERN.test(this.trimmed()));
  protected readonly canDeleteOld = computed(() => this.secrets().length === 0 || this.deleteOldAnyway());
  protected readonly submitting = computed(
    () =>
      this.step() !== 'idle' ||
      this.environmentsFacade.createEnvironment.isPending() ||
      this.environmentsFacade.deleteEnvironment.isPending() ||
      this.copyFacade.isPending(),
  );

  protected HandleNewNameInput(event: Event): void {
    this.newName.set((event.target as HTMLInputElement).value);
  }

  protected HandleDeleteOldAnywayChange(event: Event): void {
    this.deleteOldAnyway.set((event.target as HTMLInputElement).checked);
  }

  @HostListener('document:keydown', ['$event'])
  protected HandleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.closed.emit();
  }

  protected async HandleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set(null);

    const trimmed = this.trimmed();
    if (!trimmed || !NAME_PATTERN.test(trimmed)) {
      this.error.set('Enter a valid environment name.');
      return;
    }
    if (trimmed === this.oldName()) {
      this.error.set('Choose a different name.');
      return;
    }
    if (this.environments().some((env) => env.name === trimmed)) {
      this.error.set('An environment with this name already exists.');
      return;
    }
    // If secrets exist and the user hasn't checked "delete anyway", we still create the new
    // environment and copy variables below — we just skip deleting the old one afterward.

    try {
      this.step.set('creating');
      await this.environmentsFacade.createEnvironment.mutateAsync({ org: this.org(), repo: this.repo(), name: trimmed });

      const variables = this.variables();
      if (variables.length > 0) {
        this.step.set('copying');
        const newScope: ScopeRef = { org: this.org(), repo: this.repo(), env: trimmed };
        const outcomes = await Promise.all(
          variables.map((v) =>
            this.copyFacade.CopyTo('variable', v.name, v.value ?? '', [{ level: 'environment', scope: newScope, exists: false }]),
          ),
        );
        const failed = outcomes.flat().filter((r) => !r.ok);
        if (failed.length > 0) {
          this.error.set(
            `Created "${trimmed}", but ${failed.length} of ${variables.length} variable(s) failed to copy: ${failed
              .map((f) => f.message)
              .join('; ')}. The old environment "${this.oldName()}" was left in place — fix and retry, or copy them manually.`,
          );
          this.step.set('idle');
          return;
        }
      }

      if (this.canDeleteOld()) {
        this.step.set('deleting');
        await this.environmentsFacade.deleteEnvironment.mutateAsync({ org: this.org(), repo: this.repo(), name: this.oldName() });
      }

      this.renamed.emit({ oldName: this.oldName(), newName: trimmed });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'GitHub rejected this request.');
      this.step.set('idle');
    }
  }
}
