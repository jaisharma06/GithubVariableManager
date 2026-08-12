import { AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, input, output, signal } from '@angular/core';
import { CopyFacade } from '../../core/facades/CopyFacade';
import type { CopyResult } from '../../core/facades/CopySupport';
import { SameScope } from '../../core/facades/LedgerSupport';
import type { PutSecretOptions } from '../../core/gateways/ISecretsGateway';
import type { DashboardScope, GithubEnvironment, ItemLevel, LedgerItem, ScopeRef } from '../../core/Types';
import { ButtonComponent } from '../../shared/components/Button.component';
import { CrossRepoTargetPickerComponent, type CrossRepoTargetPicked } from './CrossRepoTargetPicker.component';

interface Candidate {
  key: string;
  label: string;
  level: ItemLevel;
  scope: ScopeRef;
  existing?: LedgerItem;
  /** Only set for a cross-repo/cross-org organization-level secret target — the visibility choice made in CrossRepoTargetPickerComponent. */
  options?: PutSecretOptions;
}

interface CopyFailure {
  label: string;
  message: string;
}

/** Every other scope in this repo/org that could receive a copy of `source`. */
function BuildCandidates(
  source: LedgerItem,
  scope: DashboardScope,
  environments: GithubEnvironment[],
  showOrgLevel: boolean,
  items: LedgerItem[],
): Candidate[] {
  const list: Candidate[] = [];
  if (showOrgLevel) {
    list.push({ key: 'organization', label: `Organization · ${scope.org}`, level: 'organization', scope: { org: scope.org } });
  }
  if (scope.repo) {
    list.push({
      key: 'repository',
      label: `Repository · ${scope.repo}`,
      level: 'repository',
      scope: { org: scope.org, repo: scope.repo },
    });
    for (const env of environments) {
      list.push({
        key: `env:${env.name}`,
        label: env.name,
        level: 'environment',
        scope: { org: scope.org, repo: scope.repo, env: env.name },
      });
    }
  }

  return list
    .filter((c) => !(c.level === source.level && SameScope(c.scope, source.scope)))
    .map((c) => ({
      ...c,
      existing: items.find((i) => i.kind === source.kind && i.level === c.level && i.name === source.name && SameScope(i.scope, c.scope)),
    }));
}

function LabelFor(candidates: Candidate[], result: CopyResult): string {
  const match = candidates.find((c) => c.level === result.target.level && SameScope(c.scope, result.target.scope));
  return match?.label ?? result.target.level;
}

/** Label for a candidate added via CrossRepoTargetPickerComponent — includes org/repo since it's not implied by the currently-open scope like BuildCandidates' labels are. */
function CrossRepoLabel(level: ItemLevel, scope: ScopeRef): string {
  if (level === 'organization') return `Organization · ${scope.org}`;
  if (level === 'repository') return `Repository · ${scope.org}/${scope.repo}`;
  return `${scope.org}/${scope.repo} · ${scope.env}`;
}

function CrossRepoKey(level: ItemLevel, scope: ScopeRef): string {
  return `cross:${scope.org}/${scope.repo ?? ''}/${level}/${scope.env ?? ''}`;
}

/**
 * Port of web/src/features/ledger/CopyItemDialog.tsx. `value` is seeded in ngOnInit rather than a
 * field initializer for the same reason as ItemEditorPanelComponent — see that component's doc
 * comment.
 */
@Component({
  selector: 'app-copy-item-dialog',
  imports: [ButtonComponent, CrossRepoTargetPickerComponent],
  templateUrl: './CopyItemDialog.component.html',
})
export class CopyItemDialogComponent implements OnInit, AfterViewInit {
  readonly item = input.required<LedgerItem>();
  readonly scope = input.required<DashboardScope>();
  readonly environments = input<GithubEnvironment[]>([]);
  readonly showOrgLevel = input(false);
  /** The full ledger — used to tell which destinations already have this name (create vs. update, and a same/different-value hint). */
  readonly items = input<LedgerItem[]>([]);

  readonly closed = output<void>();

  private readonly copyFacade = inject(CopyFacade);

  @ViewChild('valueInput') private readonly valueInput?: ElementRef<HTMLTextAreaElement>;

  protected readonly value = signal('');
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly error = signal<string | null>(null);
  protected readonly failures = signal<CopyFailure[] | null>(null);

  /** Targets added via CrossRepoTargetPickerComponent — outside BuildCandidates' same-org/repo scan. */
  protected readonly crossRepoCandidates = signal<Candidate[]>([]);
  protected readonly crossRepoOpen = signal(false);
  protected readonly crossRepoError = signal<string | null>(null);

  protected readonly isSecret = computed(() => this.item().kind === 'secret');
  protected readonly isPending = this.copyFacade.isPending;

  protected readonly candidates = computed(() => [
    ...BuildCandidates(this.item(), this.scope(), this.environments(), this.showOrgLevel(), this.items()),
    ...this.crossRepoCandidates(),
  ]);
  protected readonly allSelected = computed(
    () => this.candidates().length > 0 && this.selected().size === this.candidates().length,
  );

  ngOnInit(): void {
    const item = this.item();
    this.value.set(item.kind === 'variable' ? (item.value ?? '') : '');
  }

  ngAfterViewInit(): void {
    this.valueInput?.nativeElement.focus();
  }

  @HostListener('document:keydown', ['$event'])
  protected HandleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.closed.emit();
  }

  protected HandleValueInput(event: Event): void {
    this.value.set((event.target as HTMLTextAreaElement).value);
  }

  protected Toggle(key: string): void {
    this.selected.update((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected ToggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.candidates().map((c) => c.key)));
  }

  /** For a variable candidate that already has a value, whether it already matches what's about to be pushed. */
  protected AlreadyMatches(candidate: Candidate): boolean {
    return !this.isSecret() && candidate.existing?.value === this.value();
  }

  protected IsCrossRepo(candidate: Candidate): boolean {
    return candidate.key.startsWith('cross:');
  }

  protected ToggleCrossRepoOpen(): void {
    this.crossRepoOpen.update((v) => !v);
  }

  protected HandleTargetPicked(target: CrossRepoTargetPicked): void {
    this.crossRepoError.set(null);
    const item = this.item();
    const isSelf = target.level === item.level && SameScope(target.scope, item.scope);
    const isDuplicate = this.candidates().some((c) => c.level === target.level && SameScope(c.scope, target.scope));
    if (isSelf || isDuplicate) {
      this.crossRepoError.set('That destination is already in the list.');
      return;
    }

    const key = CrossRepoKey(target.level, target.scope);
    const candidate: Candidate = {
      key,
      label: CrossRepoLabel(target.level, target.scope),
      level: target.level,
      scope: target.scope,
      existing: target.existing,
      options: target.options,
    };
    this.crossRepoCandidates.update((prev) => [...prev, candidate]);
    this.selected.update((prev) => new Set(prev).add(key));
  }

  protected RemoveCrossRepoCandidate(key: string): void {
    this.crossRepoCandidates.update((prev) => prev.filter((c) => c.key !== key));
    this.selected.update((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  protected async HandleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set(null);
    this.failures.set(null);

    const selected = this.selected();
    if (selected.size === 0) {
      this.error.set('Choose at least one destination.');
      return;
    }
    const value = this.value();
    if (this.isSecret() && !value) {
      this.error.set(
        'Enter the value to push — GitHub never returns a secret’s stored value, so it can’t be read and copied automatically.',
      );
      return;
    }

    const candidates = this.candidates();
    const selectedCandidates = candidates.filter((c) => selected.has(c.key));

    // CopyFacade.CopyTo's `options` is one shared value for the whole batch, not per-target — see
    // CrossRepoTargetPickerComponent's doc comment. That's invisible for same-repo candidates
    // (BuildCandidates only ever produces one organization-level candidate), but cross-org targets
    // make it reachable: block a submit that would need two different 'selected'-visibility repo
    // lists at once, since there's nowhere for the second one to go.
    let options: PutSecretOptions | undefined;
    if (this.isSecret()) {
      const orgCandidatesWithOptions = selectedCandidates.filter((c) => c.level === 'organization' && c.options);
      const selectedVisibilityOrgs = new Set(
        orgCandidatesWithOptions.filter((c) => c.options?.visibility === 'selected').map((c) => c.scope.org),
      );
      if (selectedVisibilityOrgs.size > 1) {
        this.error.set(
          'Selected-repository visibility can only target one organization per copy — split this into separate copies.',
        );
        return;
      }
      options = orgCandidatesWithOptions[0]?.options;
    }

    const targets = selectedCandidates.map((c) => ({ level: c.level, scope: c.scope }));

    const item = this.item();
    const outcome = await this.copyFacade.CopyTo(item.kind, item.name, value, targets, options);
    if (outcome.every((r) => r.ok)) {
      this.closed.emit();
      return;
    }
    this.failures.set(outcome.filter((r) => !r.ok).map((r) => ({ label: LabelFor(candidates, r), message: r.message ?? 'Unknown error' })));
  }
}
