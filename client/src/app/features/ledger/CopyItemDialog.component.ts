import { AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, input, output, signal } from '@angular/core';
import { CopyFacade } from '../../core/facades/CopyFacade';
import type { CopyResult } from '../../core/facades/CopySupport';
import { SameScope } from '../../core/facades/LedgerSupport';
import type { DashboardScope, GithubEnvironment, ItemLevel, LedgerItem, ScopeRef } from '../../core/Types';
import { ButtonComponent } from '../../shared/components/Button.component';

interface Candidate {
  key: string;
  label: string;
  level: ItemLevel;
  scope: ScopeRef;
  existing?: LedgerItem;
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

/**
 * Port of web/src/features/ledger/CopyItemDialog.tsx. `value` is seeded in ngOnInit rather than a
 * field initializer for the same reason as ItemEditorPanelComponent — see that component's doc
 * comment.
 */
@Component({
  selector: 'app-copy-item-dialog',
  imports: [ButtonComponent],
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

  protected readonly isSecret = computed(() => this.item().kind === 'secret');
  protected readonly isPending = this.copyFacade.isPending;

  protected readonly candidates = computed(() =>
    BuildCandidates(this.item(), this.scope(), this.environments(), this.showOrgLevel(), this.items()),
  );
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
    const targets = candidates
      .filter((c) => selected.has(c.key))
      .map((c) => ({ level: c.level, scope: c.scope }));

    const item = this.item();
    const outcome = await this.copyFacade.CopyTo(item.kind, item.name, value, targets);
    if (outcome.every((r) => r.ok)) {
      this.closed.emit();
      return;
    }
    this.failures.set(outcome.filter((r) => !r.ok).map((r) => ({ label: LabelFor(candidates, r), message: r.message ?? 'Unknown error' })));
  }
}
