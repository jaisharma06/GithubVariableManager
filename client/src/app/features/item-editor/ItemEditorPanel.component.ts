import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Injector,
  OnDestroy,
  OnInit,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CopyFacade } from '../../core/facades/CopyFacade';
import { ItemMutationsFacade } from '../../core/facades/ItemMutationsFacade';
import { LedgerFacade } from '../../core/facades/LedgerFacade';
import { DetectComposeTrigger, FindComposableCandidates, IsCompositeValue, SameScope } from '../../core/facades/LedgerSupport';
import { ScopesFacade } from '../../core/facades/ScopesFacade';
import type { ResolveVariableResult } from '../../core/gateways/ILedgerGateway';
import type { PutSecretOptions } from '../../core/gateways/ISecretsGateway';
import type { DashboardScope, GithubEnvironment, ItemKind, ItemLevel, LedgerItem, ScopeRef, SecretVisibility } from '../../core/Types';
import { ButtonComponent } from '../../shared/components/Button.component';

/** Debounce window for the live composite-resolve preview — long enough to not fire on every keystroke, short enough to still feel live. */
const RESOLVE_PREVIEW_DEBOUNCE_MS = 400;

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
export class ItemEditorPanelComponent implements OnInit, AfterViewInit, OnDestroy {
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
  private readonly ledgerFacade = inject(LedgerFacade);
  private readonly injector = inject(Injector);

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
  /**
   * Set when a composite variable's create/update write succeeded but the best-effort manifest
   * update that tracks its formula failed (see `ItemMutationService.SyncManifestEntryAsync`'s doc
   * comment) — the real GitHub value is correct either way, the app just "forgot" this was a
   * formula, recoverable by re-saving. Reuses the same warning-banner shape as
   * `renameDeleteWarning`/`replicateFailures` above rather than inventing new UI for a third kind of
   * partial-failure outcome.
   */
  protected readonly manifestSyncWarning = signal<string | null>(null);

  /**
   * Composite-variable ($(OtherVarName)) live authoring feedback — debounced preview against
   * `api/`'s preview-only `POST /api/ledger/variables/resolve` endpoint (`LedgerFacade.ResolveVariable`),
   * variables only (never triggered for a secret — a secret's value gets no composite UI at all,
   * per docs/Architecture.md's write-only constraint). `null` means "no preview to show" (value
   * isn't composite, or nothing has resolved yet); `resolving` distinguishes "waiting on the
   * debounce/network round-trip" from "resolved and there's nothing composite here".
   */
  protected readonly resolvePreview = signal<ResolveVariableResult | null>(null);
  protected readonly resolvingPreview = signal(false);
  private resolveDebounceHandle: ReturnType<typeof setTimeout> | undefined;

  /**
   * Composite-formula autocomplete: eligible variable-name suggestions for whatever `$(...)` the
   * caret currently sits inside, and which row is highlighted for keyboard selection. An empty
   * list means "hide the dropdown" — there's no separate "no matches" affordance, matching this
   * app's existing "hide when not applicable" convention (see resolvePreview above).
   */
  protected readonly composeSuggestions = signal<LedgerItem[]>([]);
  protected readonly composeActiveIndex = signal(0);

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
  /** Disables the submit button once the live preview has already caught a circular formula — HandleSubmit's own check is the real guard; this is just matching UI affordance. */
  protected readonly submitBlocked = computed(
    () => this.submitting() || (this.kind() === 'variable' && this.resolvePreview()?.circular === true),
  );

  ngOnInit(): void {
    const initial = this.initial();
    this.level.set(initial?.level ?? this.initialLevel() ?? (this.scope().repo ? 'repository' : 'organization'));
    this.envName.set(initial?.scope.env ?? this.initialEnv() ?? this.environments()[0]?.name ?? '');
    this.kind.set(initial?.kind ?? this.initialKind() ?? 'variable');
    this.name.set(initial?.name ?? this.initialName() ?? '');
    // A composite variable's formula (not its already-resolved literal `value`) is what should
    // round-trip back into the value box on edit — seeding from `value` instead would silently
    // detach it from its formula on re-save (the literal doesn't match the composite regex, so the
    // manifest entry would get removed).
    this.value.set(initial?.kind === 'variable' ? (initial.formula ?? initial.value ?? '') : (this.initialValue() ?? ''));
    this.visibility.set(initial?.visibility ?? 'all');
    this.ScheduleResolvePreview();
  }

  ngAfterViewInit(): void {
    if (!this.isEdit() && !this.lockTarget()) this.nameInput?.nativeElement.focus();
    else if (this.isEdit()) this.valueInput?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    if (this.resolveDebounceHandle !== undefined) clearTimeout(this.resolveDebounceHandle);
  }

  @HostListener('document:keydown', ['$event'])
  protected HandleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.closed.emit();
  }

  protected HandleLevelChange(event: Event): void {
    this.level.set((event.target as HTMLSelectElement).value as ItemLevel);
    this.ScheduleResolvePreview();
  }

  protected HandleEnvNameChange(event: Event): void {
    this.envName.set((event.target as HTMLSelectElement).value);
    this.ScheduleResolvePreview();
  }

  protected HandleNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value.toUpperCase());
    this.ScheduleResolvePreview();
  }

  protected HandleValueInput(event: Event): void {
    this.value.set((event.target as HTMLTextAreaElement).value);
    this.ScheduleResolvePreview();
  }

  /**
   * Fires on (input)/(click)/(keyup) on the value textarea — covers typing, mouse caret
   * repositioning, and arrow-key caret movement alike, since all three can move the caret in or
   * out of an open `$(...)` reference. Kept separate from HandleValueInput (rather than folded
   * into it) because it also needs to run on events HandleValueInput never sees (click, keyup).
   */
  protected UpdateComposeSuggestions(textarea: HTMLTextAreaElement): void {
    const trigger = DetectComposeTrigger(textarea.value, textarea.selectionStart);
    if (!trigger) {
      this.composeSuggestions.set([]);
      return;
    }

    const partial = trigger.partial.toLowerCase();
    const candidates = FindComposableCandidates(this.items(), this.targetScope(), this.initial()?.id).filter((item) =>
      item.name.toLowerCase().startsWith(partial),
    );
    this.composeSuggestions.set(candidates);
    this.composeActiveIndex.set(0);
  }

  /** Bound on the value textarea itself — distinct from HandleKeydown's document-level Escape-closes-the-panel listener. */
  protected HandleValueKeydown(event: KeyboardEvent): void {
    const suggestions = this.composeSuggestions();
    if (suggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.composeActiveIndex.update((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.composeActiveIndex.update((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.SelectComposeSuggestion(suggestions[this.composeActiveIndex()], event.target as HTMLTextAreaElement);
    } else if (event.key === 'Escape') {
      // Dismiss only the popup — stopPropagation keeps this from also reaching HandleKeydown's
      // document-level listener, which would otherwise close the whole panel.
      event.preventDefault();
      event.stopPropagation();
      this.composeSuggestions.set([]);
    }
  }

  /**
   * Inserts `item.name` in place of whatever partial text triggered the suggestion, closing the
   * reference with `)`. Re-derives the trigger context from current state rather than trusting
   * whatever UpdateComposeSuggestions last computed, in case anything shifted between then and now.
   */
  protected SelectComposeSuggestion(item: LedgerItem, textarea: HTMLTextAreaElement): void {
    const trigger = DetectComposeTrigger(this.value(), textarea.selectionStart);
    if (!trigger) return;

    const newValue = this.value().slice(0, trigger.start) + item.name + ')' + this.value().slice(textarea.selectionStart);
    this.value.set(newValue);
    this.composeSuggestions.set([]);
    this.ScheduleResolvePreview();

    const caretPos = trigger.start + item.name.length + 1;
    afterNextRender(
      () => {
        textarea.focus();
        textarea.setSelectionRange(caretPos, caretPos);
      },
      { injector: this.injector },
    );
  }

  protected HandleKindChange(kind: ItemKind): void {
    this.kind.set(kind);
    this.ScheduleResolvePreview();
  }

  protected HandleVisibilityChange(event: Event): void {
    this.visibility.set((event.target as HTMLSelectElement).value as SecretVisibility);
  }

  /** Circular formulas get the same danger-tinted card chrome as `replicateFailures`/`renameDeleteWarning` below — a blocking error shouldn't share the neutral "here's your resolved value" card look. */
  protected PreviewCardClass(circular: boolean): string {
    return circular ? 'border-danger/30 bg-danger-dim' : 'border-line bg-panel-raised';
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

  /**
   * Debounced live-resolve preview — variables only, and only once the value actually looks like a
   * composite formula (`$(NAME)`), so a plain value never fires a network round-trip on every
   * keystroke. Cleared immediately (no debounce) the moment the value stops being composite, so a
   * stale preview never lingers once the user deletes the last `$(...)` reference.
   */
  private ScheduleResolvePreview(): void {
    if (this.resolveDebounceHandle !== undefined) clearTimeout(this.resolveDebounceHandle);

    if (this.kind() !== 'variable' || !IsCompositeValue(this.value())) {
      this.resolvePreview.set(null);
      this.resolvingPreview.set(false);
      return;
    }

    this.resolvingPreview.set(true);
    this.resolveDebounceHandle = setTimeout(() => void this.RunResolvePreview(), RESOLVE_PREVIEW_DEBOUNCE_MS);
  }

  private async RunResolvePreview(): Promise<void> {
    const level = this.level();
    if (level === 'environment' && !this.envName()) {
      this.resolvingPreview.set(false);
      return;
    }

    const value = this.value();
    const scope = this.targetScope();
    // The name being typed/renamed-to — not the pre-rename initial().name — so a formula that
    // references the new name it's being saved under is caught as a self-reference, matching
    // ItemMutationService's own pre-write validation (which validates against newName, not
    // currentName).
    const name = this.name();

    try {
      const result = await this.ledgerFacade.ResolveVariable(scope, level, name, value);
      // Guard against a stale response landing after the value moved on further (debounce doesn't
      // fully prevent overlap once a request is already in flight).
      if (this.value() === value) this.resolvePreview.set(result);
    } catch {
      // Preview is a soft, best-effort convenience — a failed preview call clears silently rather
      // than surfacing an error; it never blocks saving (the server-side check on submit still is).
      if (this.value() === value) this.resolvePreview.set(null);
    } finally {
      if (this.value() === value) this.resolvingPreview.set(false);
    }
  }

  protected async HandleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set(null);
    this.replicateFailures.set(null);
    this.renameDeleteWarning.set(null);
    this.manifestSyncWarning.set(null);

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
    // Client-side fast feedback for a genuine circular composite reference — the fresh
    // preview may not have resolved yet (a submit right after typing, before the debounce fired),
    // in which case ItemMutationService's own pre-write validation is the authoritative backstop
    // and rejects with a 400. An *unresolved* (non-circular) forward reference is never blocked.
    if (kind === 'variable' && this.resolvePreview()?.circular) {
      this.error.set(this.resolvePreview()!.circularError ?? 'This formula creates a circular reference.');
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
        const result = isEdit
          ? await this.itemMutationsFacade.updateVariable.mutateAsync({
              scope: targetScope,
              level,
              currentName: this.initial()!.name,
              newName: name,
              value,
            })
          : await this.itemMutationsFacade.createVariable.mutateAsync({ scope: targetScope, level, name, value });
        if (!result.manifestSynced) {
          this.manifestSyncWarning.set(
            `Saved, but couldn't record this as a formula for later syncing: ${result.manifestSyncError ?? 'Unknown error'}`,
          );
          return;
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
