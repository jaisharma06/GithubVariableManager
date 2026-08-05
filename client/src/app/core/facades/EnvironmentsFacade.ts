import { Injectable, inject } from '@angular/core';
import { injectMutation, injectQuery, injectQueryClient } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/AuthService';
import { ENVIRONMENTS_GATEWAY, type IEnvironmentsGateway } from '../gateways/IEnvironmentsGateway';
import type { GithubEnvironment } from '../Types';

interface EnvironmentMutationParams {
  org: string;
  repo: string;
  name: string;
}

/** Facade over IEnvironmentsGateway — port of the useEnvironments/useCreateEnvironment/useDeleteEnvironment hooks. */
@Injectable({ providedIn: 'root' })
export class EnvironmentsFacade {
  private readonly environmentsGateway = inject<IEnvironmentsGateway>(ENVIRONMENTS_GATEWAY);
  private readonly authService = inject(AuthService);
  private readonly queryClient = injectQueryClient();

  EnvironmentsQuery(org: () => string, repo: () => string | undefined) {
    return injectQuery(() => ({
      queryKey: ['environments', this.authService.token(), org(), repo()],
      queryFn: () => this.environmentsGateway.ListEnvironments(org(), repo()!),
      enabled: !!this.authService.token() && !!repo(),
    }));
  }

  readonly createEnvironment = injectMutation(() => ({
    mutationFn: (p: EnvironmentMutationParams) => this.environmentsGateway.CreateEnvironment(p.org, p.repo, p.name),
    onMutate: async (p) => {
      const key = ['environments', this.authService.token(), p.org, p.repo];
      await this.queryClient.cancelQueries({ queryKey: key });
      const previous = this.queryClient.getQueryData<GithubEnvironment[]>(key);
      // Insert immediately rather than waiting on a refetch — GitHub's list-environments read
      // can lag a moment behind the write that just succeeded, which otherwise makes a brand
      // new environment briefly (or indefinitely, if nothing else triggers a refetch) invisible.
      this.queryClient.setQueryData<GithubEnvironment[]>(key, (old) => {
        const list = old ?? [];
        return list.some((e) => e.name === p.name) ? list : [...list, { name: p.name, id: -Date.now() }];
      });
      return { previous, key };
    },
    // No refetch on success — the PUT succeeding is itself the confirmation, and GitHub's list
    // read can lag behind the write by a moment (which would otherwise "un-create" it in the UI).
    // LedgerFacade's query key already derives from this list, so it re-runs automatically once
    // it changes — no manual ledger invalidation needed either.
    onError: (_err, _p, context) => {
      if (context) this.queryClient.setQueryData(context.key, context.previous);
    },
  }));

  readonly deleteEnvironment = injectMutation(() => ({
    mutationFn: (p: EnvironmentMutationParams) => this.environmentsGateway.DeleteEnvironment(p.org, p.repo, p.name),
    onMutate: async (p) => {
      const key = ['environments', this.authService.token(), p.org, p.repo];
      await this.queryClient.cancelQueries({ queryKey: key });
      const previous = this.queryClient.getQueryData<GithubEnvironment[]>(key);
      this.queryClient.setQueryData<GithubEnvironment[]>(key, (old) => (old ?? []).filter((e) => e.name !== p.name));
      return { previous, key };
    },
    onError: (_err, _p, context) => {
      if (context) this.queryClient.setQueryData(context.key, context.previous);
    },
  }));
}
