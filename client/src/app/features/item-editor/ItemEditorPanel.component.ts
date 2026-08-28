import { AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, input, output, signal } from '@angular/core';
import { CopyFacade } from '../../core/facades/CopyFacade';
import { ItemMutationsFacade } from '../../core/facades/ItemMutationsFacade';
import { SameScope } from '../../core/facades/LedgerSupport';
import { ScopesFacade } from '../../core/facades/ScopesFacade';
import type { PutSecretOptions } from '../../core/gateways/ISecretsGateway';
import type { DashboardScope, GithubEnvironment, ItemKind, ItemLevel, LedgerItem, ScopeRef, SecretVisibility } from '../../core/Types';
import { ButtonComponent } from '../../shared/components/Button.component';

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface ReplicateCandidate {
  key: string;
  label: string;
  scope: ScopeRef;
  existing?: LedgerItem;
}

interface ReplicateFailure {
  label: string;
  message: string;
}

/**
 * Port of web/src/features/item-editor/ItemEditorPanel.tsx. All the form fields it seeds from
 * inputs (`level`/`envName`/`kind`/`name`/`value`/`visibility`) are writable signals initialized
 * in ngOnInit rather than field initializers — several depend on required inputs (`scope`), and
 * reading a required input in a field initializer throws NG0950 under `TestBed.createComponent()`
 * + `setInput()` (see RenameEnvironmentDialogComponent's doc comment / core/testing/README.md for
 * the full explanation). Since this component is only ever created fresh (behind an `@if` that
 * flips null -> non-null), ngOnInit running once per open matches the React original's
 * per-mount `useState()` initializers exactly.
 */
@Component({
  selector: 'app-item-editor-panel',
  imports: [ButtonComponent],
  templateUrl: './ItemEditorPanel.component.html',
})
export class ItemEditorPanelComponent implements OnInit, AfterViewInit {
  readonly scope = input.required<DashboardScope>();
  readonly environments = input<GithubEnvironment[]>([]);
  /** The full ledger — used to decide create-vs-update when replicating to other environments. */
  readonly items = input<LedgerItem[]>([]);
  readonly initial = input<LedgerItem | null>(null);
  /** Pre-fill the level/environment when opened from a section's own "+ Add" button. */
  readonly initialLevel = input<ItemLevel | undefined>(undefined);
  readonly initialEnv = input<string | undefined>(undefined);
  /** Pre-fill name/kind when opened to fill in one specific cell (used by CompareView — Phase 8). */
  readonly initialName = input<string | undefined>(undefined);
  readonly initialKind = input<ItemKind | undefined>(undefined);
  /** Pre-fill the value when opened via a variable paste (VariableClipboardService) — never set for a secret, since a secret's value can never be silently carried over. */
  readonly initialValue = input<string | undefined>(undefined);
  /** Locks level/environment/name/kind — used when the target scope+name is already decided for us. */
  readonly lockTarget = input(false);
  readonly showOrgLevel = input.required<boolean>();

  readonly closed = output<void>();

  private readonly itemMutationsFacade = inject(ItemMutationsFacade);
  private readonly copyFacade = inject(CopyFacade);
  private readonly scopesFacade = inject(ScopesFacade);

  @ViewChild('nameInput') private readonly nameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('valueInput') private readonly valueInput?: ElementRef<HTMLTextAreaElement>;

  protected readonly level = signal<ItemLevel>('repository');
  protected readonly envName = signal('');
  protected readonly kind = signal<ItemKind>('variable');
  protected readonly name = signal('');
  protected readonly value = signal('');
  protected readonly visibility = signal<SecretVisibility>('all');
  protected readonly selectedRepoIds = signal<Set<number>>(new Set());
  protected readonly replicateEnvs = signal<Set<string>>(new Set());
  protected readonly error = signal<string | null>(null);
  protected readonly replicateFailures = signal<ReplicateFailure[] | null>(null);
  /**
   * Set when a secret rename's PUT (new name) step succeeded but the DELETE (old name) step
   * failed — GitHub genuinely now has both entries, and there's no GitHub API making the two-step
   * rename transactional (see `ItemMutationsFacade.renameSecret`'s doc comment). Reuses the same
   * warning-banner shape as `replicateFailures` below rather than inventing new UI for a second
   * kind of partial-failure outcome.
   */
  protected readonly renameDeleteWarning = signal<string | null>(null);

  protected readonly isEdit = computed(() => this.initial() !== null);
  /** True only for a fresh create opened via SectionHeaderComponent's "Paste" action — drives the "from clipboard" provenance note, mirroring how isEdit()/lockTarget() already distinguish this form's other open-modes. */
  protected readonly pastedFromClipboard = computed(() => !this.isEdit() && !this.lockTarget() && this.initialValue() !== undefined);
  protected readonly isRenaming = computed(() => this.isEdit() && this.name() !== this.initial()!.name);
  protected readonly nameValid = computed(() => this.name().length === 0 || NAME_PATTERN.test(this.name()));
  protected readonly needsVisibilityPicker = computed(() => this.kind() === 'secret' && this.level() === 'organization');

  protected readonly targetScope = computed<ScopeRef>(() => {
    const s = this.scope();
    if (this.level() === 'organization') return { org: s.org };
    if (this.level() === 'repository') return { org: s.org, repo: s.repo };
    return { org: s.org, repo: s.repo, env: this.envName() };
  });

  /** Other environments this new item could also be created in, in one go. */
  protected readonly replicateCandidates = computed<ReplicateCandidate[]>(() => {
    if (this.isEdit() || this.lockTarget() || !this.scope().repo) return [];
    const s = this.scope();
    const kind = this.kind();
    const name = this.name();
    return this.environments()
      .filter((env) => !(this.level() === 'environment' && env.name === this.envName()))
      .map((env) => {
        const envScope: ScopeRef = { org: s.org, repo: s.repo, env: env.name };
        return {
          key: env.name,
          label: env.name,
          scope: envScope,
          existing: this.items().find(
            (i) => i.kind === kind && i.level === 'environment' && i.name === name && SameScope(i.scope, envScope),
          ),
        };
      });
  });

  protected readonly orgReposQuery = this.scopesFacade.OrgReposQuery(
    () => this.scope().org,
    () => this.needsVisibilityPicker() && this.visibility() === 'selected',
  );

  protected readonly submitting = computed(
    () =>
      this.itemMutationsFacade.createVariable.isPending() ||
      this.itemMutationsFacade.updateVariable.isPending() ||
      this.itemMutationsFacade.putSecret.isPending() ||
      this.itemMutationsFacade.renameSecret.isPending() ||
      this.copyFacade.isPending(),
  );

  ngOnInit(): void {
    const initial = this.initial();
    this.level.set(initial?.level ?? this.initialLevel() ?? (this.scope().repo ? 'repository' : 'organization'));
    this.envName.set(initial?.scope.env ?? this.initialEnv() ?? this.environments()[0]?.name ?? '');
    this.kind.set(initial?.kind ?? this.initialKind() ?? 'variable');
    this.name.set(initial?.name ?? this.initialName() ?? '');
    this.value.set(initial?.kind === 'variable' ? (initial.value ?? '') : (this.initialValue() ?? ''));
    this.visibility.set(initial?.visibility ?? 'all');
  }

  ngAfterViewInit(): void {
    if (!this.isEdit() && !this.lockTarget()) this.nameInput?.nativeElement.focus();
    else if (this.isEdit()) this.valueInput?.nativeElement.focus();
  }

  @HostListener('document:keydown', ['$event'])
  protected HandleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.closed.emit();
  }

  protected HandleLevelChange(event: Event): void {
    this.level.set((event.target as HTMLSelectElement).value as ItemLevel);
  }

  protected HandleEnvNameChange(event: Event): void {
    this.envName.set((event.target as HTMLSelectElement).value);
  }

  protected HandleNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value.toUpperCase());
  }

  protected HandleValueInput(event: Event): void {
    this.value.set((event.target as HTMLTextAreaElement).value);
  }

  protected HandleVisibilityChange(event: Event): void {
    this.visibility.set((event.target as HTMLSelectElement).value as SecretVisibility);
  }

  protected KindOptionClasses(tone: ItemKind): string {
    const active = this.kind() === tone;
    const toneClass = tone === 'variable' ? 'border-variable bg-variable-dim text-variable' : 'border-secret bg-secret-dim text-secret';
    return `flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${active ? toneClass : 'border-line text-text-dim hover:text-text'}`;
  }

  protected ToggleRepo(id: number): void {
    this.selectedRepoIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected ToggleReplicateEnv(key: string): void {
    this.replicateEnvs.update((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected async HandleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set(null);
    this.replicateFailures.set(null);
    this.renameDeleteWarning.set(null);

    const name = this.name();
    if (!name.trim() || !NAME_PATTERN.test(name)) {
      this.error.set('Name must start with a letter or underscore and contain only letters, numbers, and underscores.');
      return;
    }
    if (this.level() === 'environment' && !this.envName()) {
      this.error.set('Choose an environment.');
      return;
    }
    const kind = this.kind();
    const value = this.value();
    const isEdit = this.isEdit();
    const isRenaming = this.isRenaming();
    if (kind === 'variable' && !value.trim()) {
      this.error.set('Enter a value for this variable.');
      return;
    }
    if (kind === 'secret' && (!isEdit || isRenaming) && !value) {
      this.error.set(
        isRenaming
          ? 'Enter a value — GitHub can’t copy a secret’s value when renaming it, so you’ll need to re-enter it under the new name.'
          : 'Enter a value for this secret.',
      );
      return;
    }

    const level = this.level();
    const options: PutSecretOptions | undefined =
      kind === 'secret' && level === 'organization'
        ? { visibility: this.visibility(), selectedRepositoryIds: [...this.selectedRepoIds()] }
        : undefined;
    const targetScope = this.targetScope();

    try {
      if (kind === 'variable') {
        if (isEdit) {
          await this.itemMutationsFacade.updateVariable.mutateAsync({
            scope: targetScope,
            level,
            currentName: this.initial()!.name,
            newName: name,
            value,
          });
        } else {
          await this.itemMutationsFacade.createVariable.mutateAsync({ scope: targetScope, level, name, value });
        }
      } else if (isEdit && isRenaming) {
        const result = await this.itemMutationsFacade.renameSecret.mutateAsync({
          scope: targetScope,
          level,
          currentName: this.initial()!.name,
          newName: name,
          value,
          options,
        });
        if (!result.deleteSucceeded) {
          this.renameDeleteWarning.set(
            `Saved under the new name, but couldn't remove the old one (${this.initial()!.name}): ${result.deleteError ?? 'Unknown error'}`,
          );
          return;
        }
      } else if (isEdit && !value) {
        this.closed.emit();
        return;
      } else {
        await this.itemMutationsFacade.putSecret.mutateAsync({ scope: targetScope, level, name, value, options });
      }

      if (!isEdit && this.replicateEnvs().size > 0) {
        const candidates = this.replicateCandidates();
        const targets = candidates
          .filter((c) => this.replicateEnvs().has(c.key))
          .map((c) => ({ level: 'environment' as const, scope: c.scope }));
        const outcome = await this.copyFacade.CopyTo(kind, name, value, targets, options);
        if (!outcome.every((r) => r.ok)) {
          this.replicateFailures.set(
            outcome
              .filter((r) => !r.ok)
              .map((r) => ({
                label: candidates.find((c) => SameScope(c.scope, r.target.scope))?.label ?? r.target.scope.env ?? '?',
                message: r.message ?? 'Unknown error',
              })),
          );
          return;
        }
      }

      this.closed.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'GitHub rejected this request.');
    }
  }
}
