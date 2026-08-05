import { AfterViewInit, Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/AuthService';
import { LastScopeService } from '../../core/services/LastScopeService';
import { ScopesFacade } from '../../core/facades/ScopesFacade';

/**
 * Port of web/src/features/scope-picker/ScopePicker.tsx. The search input is focused
 * programmatically on init rather than via the `autofocus` attribute — same
 * ElementRef-in-`ngAfterViewInit` pattern as ButtonComponent.Focus()/ConfirmDialogComponent;
 * `autofocus` is flagged by @angular-eslint/template/no-autofocus for good reason (it's a real
 * a11y anti-pattern), and this delivers the same "cursor's ready to type" UX without it.
 */
@Component({
  selector: 'app-scope-picker',
  templateUrl: './ScopePicker.component.html',
})
export class ScopePickerComponent implements AfterViewInit {
  protected readonly authService = inject(AuthService);
  private readonly scopesFacade = inject(ScopesFacade);
  private readonly lastScopeService = inject(LastScopeService);
  private readonly router = inject(Router);

  @ViewChild('searchInput') private readonly searchInput?: ElementRef<HTMLInputElement>;

  ngAfterViewInit(): void {
    this.searchInput?.nativeElement.focus();
  }

  protected readonly orgsQuery = this.scopesFacade.MyOrgsQuery();
  protected readonly reposQuery = this.scopesFacade.MyReposQuery();
  protected readonly lastScope = this.lastScopeService.GetLastScope();

  protected readonly query = signal('');

  protected readonly loading = computed(() => this.orgsQuery.isLoading() || this.reposQuery.isLoading());

  protected readonly filteredOrgs = computed(() =>
    (this.orgsQuery.data() ?? []).filter((o) => o.login.toLowerCase().includes(this.query().toLowerCase())),
  );
  protected readonly filteredRepos = computed(() =>
    (this.reposQuery.data() ?? []).filter((r) => r.fullName.toLowerCase().includes(this.query().toLowerCase())),
  );

  protected HandleQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected GoToLastScope(): void {
    if (this.lastScope) void this.router.navigateByUrl(this.lastScope.path);
  }

  protected GoToOrg(login: string): void {
    void this.router.navigate(['/o', login]);
  }

  protected GoToRepo(owner: string, name: string): void {
    void this.router.navigate(['/r', owner, name]);
  }

  protected HandleDisconnect(): void {
    this.authService.SignOut();
    void this.router.navigateByUrl('/connect');
  }
}
