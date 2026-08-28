import { AfterViewInit, Component, ElementRef, HostListener, ViewChild, computed, inject, input, output, signal } from '@angular/core';
import { EnvironmentsFacade } from '../../core/facades/EnvironmentsFacade';
import { ScopesFacade } from '../../core/facades/ScopesFacade';
import type { EnvironmentVariableCopyResult } from '../../core/facades/CopySupport';
import type { ScopeRef } from '../../core/Types';
import { ButtonComponent } from '../../shared/components/Button.component';

interface PickedRepo {
  owner: string;
  name: string;
}

/**
 * Destination org/repo/environment picker + submit/outcome UI for "copy every variable from one
 * environment to another". Deliberately its own lightweight picker rather than a reuse/extraction
 * of `CrossRepoTargetPickerComponent` — that component is hard-coupled to a single `LedgerItem`
 * and secret-visibility fields this Variables-only, one-destination feature doesn't need (same
 * doc-comment precedent `CrossRepoTargetPickerComponent` itself already follows for not reusing
 * `ScopePickerComponent`). Unlike that picker (which supports organization/repository/environment
 * level targets), this one only ever targets an *environment* — copying variables between
 * environments is the whole feature — so it always requires a repo before it can show anything to
 * pick further, and never offers an organization- or repository-level destination.
 *
 * All business logic (listing, skip-if-exists, the substring value transform, per-variable failure
 * isolation) lives server-side in `api/Services/EnvironmentVariableCopyService.cs` — this component
 * only collects the destination and renders whatever outcome the backend reports, mirroring
 * `RenameEnvironmentDialogComponent`'s post-Phase-3c shape (one backend call, no client-side
 * orchestration).
 */
@Component({
  selector: 'app-copy-environment-dialog',
  imports: [ButtonComponent],
  templateUrl: './CopyEnvironmentDialog.component.html',
})
export class CopyEnvironmentDialogComponent implements AfterViewInit {
  readonly org = input.required<string>();
  readonly repo = input.required<string>();
  /** The environment the action was triggered from — the copy source, fixed for the lifetime of this dialog. */
  readonly sourceEnv = input.required<string>();

  readonly closed = output<void>();

  private readonly scopesFacade = inject(ScopesFacade);
  private readonly environmentsFacade = inject(EnvironmentsFacade);

  @ViewChild('queryInput') private readonly queryInput?: ElementRef<HTMLInputElement>;

  protected readonly query = signal('');
  protected readonly destPickedOrg = signal<string | null>(null);
  protected readonly destPickedRepo = signal<PickedRepo | null>(null);
  protected readonly destEnvName = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<EnvironmentVariableCopyResult | null>(null);

  protected readonly orgsQuery = this.scopesFacade.MyOrgsQuery();
  protected readonly reposQuery = this.scopesFacade.MyReposQuery();

  protected readonly filteredOrgs = computed(() =>
    (this.orgsQuery.data() ?? []).filter((o) => o.login.toLowerCase().includes(this.query().toLowerCase())),
  );
  protected readonly filteredRepos = computed(() =>
    (this.reposQuery.data() ?? []).filter((r) => r.fullName.toLowerCase().includes(this.query().toLowerCase())),
  );

  protected readonly destinationOrg = computed(() => this.destPickedOrg() ?? this.destPickedRepo()?.owner ?? null);
  protected readonly destinationRepo = computed(() => this.destPickedRepo()?.name);

  /** Repos in a picked org — lets the user pick a specific repo once they've narrowed to an org (environments are always repo-scoped). */
  protected readonly orgReposQuery = this.scopesFacade.OrgReposQuery(
    () => this.destPickedOrg(),
    () => this.destPickedOrg() !== null,
  );

  protected readonly destEnvironmentsQuery = this.environmentsFacade.EnvironmentsQuery(
    () => this.destinationOrg() ?? '',
    () => this.destinationRepo(),
  );

  protected readonly isSameScope = computed(
    () => this.destinationOrg() === this.org() && this.destinationRepo() === this.repo() && this.destEnvName() === this.sourceEnv(),
  );

  protected readonly submitDisabled = computed(
    () => !this.destinationRepo() || !this.destEnvName() || this.isSameScope() || this.copyPending(),
  );

  protected readonly copyPending = this.environmentsFacade.copyEnvironmentVariables.isPending;

  ngAfterViewInit(): void {
    this.queryInput?.nativeElement.focus();
  }

  @HostListener('document:keydown', ['$event'])
  protected HandleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.closed.emit();
  }

  protected HandleQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected PickOrg(login: string): void {
    this.destPickedOrg.set(login);
    this.destPickedRepo.set(null);
    this.destEnvName.set('');
  }

  protected PickRepo(owner: string, name: string): void {
    this.destPickedRepo.set({ owner, name });
    this.destPickedOrg.set(null);
    this.destEnvName.set('');
  }

  protected ClearDestination(): void {
    this.destPickedOrg.set(null);
    this.destPickedRepo.set(null);
    this.destEnvName.set('');
    this.query.set('');
  }

  protected HandleEnvNameChange(event: Event): void {
    this.destEnvName.set((event.target as HTMLSelectElement).value);
  }

  protected async HandleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set(null);
    this.result.set(null);

    const destOrg = this.destinationOrg();
    const destRepo = this.destinationRepo();
    const destEnv = this.destEnvName();
    if (!destOrg || !destRepo || !destEnv) {
      this.error.set('Choose a destination environment.');
      return;
    }
    if (this.isSameScope()) {
      this.error.set('Choose a different environment — this is the same as the source.');
      return;
    }

    const source: ScopeRef = { org: this.org(), repo: this.repo(), env: this.sourceEnv() };
    const dest: ScopeRef = { org: destOrg, repo: destRepo, env: destEnv };

    try {
      const outcome = await this.environmentsFacade.copyEnvironmentVariables.mutateAsync({ source, dest });
      this.result.set(outcome);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'GitHub rejected this request.');
    }
  }
}
