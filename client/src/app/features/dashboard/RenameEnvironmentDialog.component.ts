import { AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, input, output, signal } from '@angular/core';
import { EnvironmentsFacade } from '../../core/facades/EnvironmentsFacade';
import type { LedgerItem } from '../../core/Types';
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
 *
 * As of Phase 3c, the create-new-environment -> copy-variables -> conditionally-delete-old-one
 * orchestration this dialog used to drive step-by-step (3 separate mutation calls, one dialog-owned
 * `step` signal to track which) is one backend call
 * (`EnvironmentsFacade.renameEnvironment` -> `api/Services/EnvironmentRenameService.cs`). This
 * component now only collects the new name, does the same zero-round-trip format checks it always
 * did client-side (non-empty / pattern / not-same-as-old — cheap, static, arguably not "business
 * logic"), and reports whatever outcome the backend returns. The "already in use" duplicate check
 * moved server-side (it needs live GitHub state), surfaced through the existing `catch` handler as
 * a plain error message — same as any other validation failure this dialog already displayed.
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
  /** The full ledger — used to find what's currently set in this environment. */
  readonly items = input<LedgerItem[]>([]);

  readonly closed = output<void>();
  readonly renamed = output<EnvironmentRenamedEvent>();

  private readonly environmentsFacade = inject(EnvironmentsFacade);

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

  protected readonly variables = computed(() =>
    this.items().filter((i) => i.kind === 'variable' && i.level === 'environment' && i.scope.env === this.oldName()),
  );
  protected readonly secrets = computed(() =>
    this.items().filter((i) => i.kind === 'secret' && i.level === 'environment' && i.scope.env === this.oldName()),
  );
  protected readonly secretNames = computed(() => this.secrets().map((s) => s.name).join(', '));

  protected readonly trimmed = computed(() => this.newName().trim());
  protected readonly nameValid = computed(() => this.trimmed().length === 0 || NAME_PATTERN.test(this.trimmed()));
  protected readonly submitting = computed(() => this.environmentsFacade.renameEnvironment.isPending());

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

    try {
      const result = await this.environmentsFacade.renameEnvironment.mutateAsync({
        org: this.org(),
        repo: this.repo(),
        oldName: this.oldName(),
        newName: trimmed,
        deleteOldAnyway: this.deleteOldAnyway(),
      });

      if (result.listVariablesError) {
        this.error.set(
          `Created "${trimmed}", but its variables couldn't be listed to copy: ${result.listVariablesError}. ` +
            `The old environment "${this.oldName()}" was left in place — fix and retry, or copy them manually.`,
        );
        return;
      }
      if (result.variableCopyFailures.length > 0) {
        const totalAttempted = result.variablesCopied + result.variableCopyFailures.length;
        this.error.set(
          `Created "${trimmed}", but ${result.variableCopyFailures.length} of ${totalAttempted} variable(s) failed to copy: ${result.variableCopyFailures
            .map((f) => f.error)
            .join('; ')}. The old environment "${this.oldName()}" was left in place — fix and retry, or copy them manually.`,
        );
        return;
      }

      if (result.oldEnvironmentDeleteError) {
        // The rename itself fully succeeded (new environment created, every variable copied) —
        // only cleanup of the old one failed. Mirrors ItemEditorPanelComponent's identical choice
        // for a secret rename whose delete-old step fails: stay open and show the warning rather
        // than emit success and close, since closing here (which unmounts this dialog in
        // DashboardShellComponent) would make any warning set afterward invisible.
        this.error.set(
          `Renamed to "${trimmed}", but removing "${this.oldName()}" failed: ${result.oldEnvironmentDeleteError}. Delete it manually when ready.`,
        );
        return;
      }

      this.renamed.emit({ oldName: this.oldName(), newName: trimmed });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'GitHub rejected this request.');
    }
  }
}
