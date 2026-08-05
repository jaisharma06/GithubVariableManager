import { Component, computed, inject, input } from '@angular/core';
import { GitHubApiError } from '../../core/gateways/GitHubApiError';
import { RunnersFacade } from '../../core/facades/RunnersFacade';
import type { DashboardScope, Runner } from '../../core/Types';

/** Port of web/src/features/dashboard/RunnersPanel.tsx. */
@Component({
  selector: 'app-runners-panel',
  templateUrl: './RunnersPanel.component.html',
})
export class RunnersPanelComponent {
  readonly scope = input.required<DashboardScope>();

  private readonly runnersFacade = inject(RunnersFacade);
  protected readonly runnersQuery = this.runnersFacade.RunnersQuery(() => this.scope());

  protected readonly runners = computed(() => this.runnersQuery.data() ?? []);
  protected readonly onlineCount = computed(() => this.runners().filter((r) => r.status === 'online').length);

  protected readonly noAccess = computed(() => {
    const err = this.runnersQuery.error();
    return err instanceof GitHubApiError && (err.status === 403 || err.status === 404);
  });
  protected readonly errorMessage = computed(() => {
    const err = this.runnersQuery.error();
    return err instanceof Error ? err.message : 'Couldn’t load runners.';
  });

  protected RunnerState(runner: Runner): 'online' | 'busy' | 'offline' {
    return runner.status !== 'online' ? 'offline' : runner.busy ? 'busy' : 'online';
  }

  protected RunnerDotClass(runner: Runner): string {
    const state = this.RunnerState(runner);
    return state === 'online' ? 'bg-ok' : state === 'busy' ? 'bg-variable' : 'bg-text-dim';
  }

  protected RunnerLabelClass(runner: Runner): string {
    const state = this.RunnerState(runner);
    return state === 'online' ? 'text-ok' : state === 'busy' ? 'text-variable' : 'text-text-dim';
  }

  protected RunnerTitle(runner: Runner): string {
    const labels = runner.labels.map((l) => l.name).join(', ');
    return labels ? `${runner.os} · ${labels}` : runner.os;
  }
}
