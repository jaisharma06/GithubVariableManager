import { Component, computed, inject, input, output, signal } from '@angular/core';
import { EnvironmentsFacade } from '../../core/facades/EnvironmentsFacade';
import { LedgerFacade } from '../../core/facades/LedgerFacade';
import { SameScope } from '../../core/facades/LedgerSupport';
import { ScopesFacade } from '../../core/facades/ScopesFacade';
import type { PutSecretOptions } from '../../core/gateways/ISecretsGateway';
import type { ItemLevel, LedgerItem, ScopeRef, SecretVisibility } from '../../core/Types';
import { ButtonComponent } from '../../shared/components/Button.component';

export interface CrossRepoTargetPicked {
  level: ItemLevel;
  scope: ScopeRef;
  /** Only set for a secret pushed to an organization-level target. */
  options?: PutSecretOptions;
  /** The already-loaded item at this destination, if any — powers CopyItemDialog's overwrite/matches/not-set hint without a second lookup. */
  existing?: LedgerItem;
}

interface PickedRepo {
  owner: string;
  name: string;
}

/**
 * Picker-only widget (Single Responsibility — decides *what target*, never performs the copy)
 * that lets CopyItemDialogComponent offer a destination outside the currently-open org/repo.
 * Deliberately not a reuse of ScopePickerComponent — that component is router-driven (navigates
 * the whole app via `Router.navigate`), the wrong shape for a widget embedded in a dialog.
 *
 * Once an org or repo is picked, this component loads that destination's own ledger
 * (`LedgerFacade.LedgerQuery`, scoped to the picked org/repo — independent of whatever scope the
 * dashboard currently has open) so "Add destination" can hand back an accurate existing-item hint
 * in the same click, without CopyItemDialogComponent needing a second lookup mechanism.
 */
@Component({
  selector: 'app-cross-repo-target-picker',
  imports: [ButtonComponent],
  templateUrl: './CrossRepoTargetPicker.component.html',
})
export class CrossRepoTargetPickerComponent {
  /** The item being copied — used to look up whether it already exists at the picked destination. */
  readonly item = input.required<LedgerItem>();

  readonly targetPicked = output<CrossRepoTargetPicked>();

  private readonly scopesFacade = inject(ScopesFacade);
  private readonly environmentsFacade = inject(EnvironmentsFacade);
  private readonly ledgerFacade = inject(LedgerFacade);

  protected readonly query = signal('');
  protected readonly pickedOrg = signal<string | null>(null);
  protected readonly pickedRepo = signal<PickedRepo | null>(null);
  protected readonly level = signal<ItemLevel>('organization');
  protected readonly envName = signal('');
  protected readonly visibility = signal<SecretVisibility>('all');
  protected readonly selectedRepoIds = signal<Set<number>>(new Set());
  protected readonly pickError = signal<string | null>(null);

  protected readonly orgsQuery = this.scopesFacade.MyOrgsQuery();
  protected readonly reposQuery = this.scopesFacade.MyReposQuery();

  protected readonly filteredOrgs = computed(() =>
    (this.orgsQuery.data() ?? []).filter((o) => o.login.toLowerCase().includes(this.query().toLowerCase())),
  );
  protected readonly filteredRepos = computed(() =>
    (this.reposQuery.data() ?? []).filter((r) => r.fullName.toLowerCase().includes(this.query().toLowerCase())),
  );

  protected readonly destinationOrg = computed(() => this.pickedOrg() ?? this.pickedRepo()?.owner ?? null);
  protected readonly destinationRepo = computed(() => this.pickedRepo()?.name);

  /** Org-level Actions vars/secrets only exist for real Organization accounts — a repo owned by a personal User account has none. An org picked directly from MyOrgsQuery is always a real org already. */
  protected readonly isOrgAccountQuery = this.scopesFacade.IsOrgAccountQuery(() => this.pickedRepo()?.owner ?? null);
  protected readonly canOfferOrgLevel = computed(() => this.pickedOrg() !== null || this.isOrgAccountQuery.data() === true);

  protected readonly environmentsQuery = this.environmentsFacade.EnvironmentsQuery(
    () => this.destinationOrg() ?? '',
    () => this.destinationRepo(),
  );

  protected readonly ledgerQuery = this.ledgerFacade.LedgerQuery(() =>
    this.destinationOrg() ? { org: this.destinationOrg()!, repo: this.destinationRepo() } : null,
  );

  protected readonly needsVisibilityPicker = computed(
    () => this.item().kind === 'secret' && this.level() === 'organization' && this.destinationOrg() !== null,
  );

  protected readonly orgReposQuery = this.scopesFacade.OrgReposQuery(
    () => this.destinationOrg(),
    () => this.needsVisibilityPicker() && this.visibility() === 'selected',
  );

  protected readonly addDisabled = computed(
    () => this.ledgerQuery.isLoading() || (this.level() === 'environment' && !this.envName()),
  );

  protected HandleQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected PickOrg(login: string): void {
    this.pickedOrg.set(login);
    this.pickedRepo.set(null);
    this.level.set('organization');
    this.envName.set('');
    this.pickError.set(null);
  }

  protected PickRepo(owner: string, name: string): void {
    this.pickedRepo.set({ owner, name });
    this.pickedOrg.set(null);
    this.level.set('repository');
    this.envName.set('');
    this.pickError.set(null);
  }

  protected ClearPick(): void {
    this.pickedOrg.set(null);
    this.pickedRepo.set(null);
    this.query.set('');
    this.pickError.set(null);
  }

  protected HandleLevelChange(event: Event): void {
    this.level.set((event.target as HTMLSelectElement).value as ItemLevel);
  }

  protected HandleEnvNameChange(event: Event): void {
    this.envName.set((event.target as HTMLSelectElement).value);
  }

  protected HandleVisibilityChange(event: Event): void {
    this.visibility.set((event.target as HTMLSelectElement).value as SecretVisibility);
  }

  protected ToggleRepo(id: number): void {
    this.selectedRepoIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected HandleAddTarget(): void {
    const org = this.destinationOrg();
    if (!org) return;
    const level = this.level();
    if (level === 'environment' && !this.envName()) {
      this.pickError.set('Choose an environment.');
      return;
    }

    const scope: ScopeRef =
      level === 'organization' ? { org } : level === 'repository' ? { org, repo: this.destinationRepo() } : { org, repo: this.destinationRepo(), env: this.envName() };

    const item = this.item();
    const existing = (this.ledgerQuery.data()?.items ?? []).find(
      (i) => i.kind === item.kind && i.level === level && i.name === item.name && SameScope(i.scope, scope),
    );
    const options: PutSecretOptions | undefined = this.needsVisibilityPicker()
      ? { visibility: this.visibility(), selectedRepositoryIds: [...this.selectedRepoIds()] }
      : undefined;

    this.targetPicked.emit({ level, scope, options, existing });
    this.ClearPick();
  }
}
