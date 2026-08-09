import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';

import { AuthInterceptor } from './core/interceptors/AuthInterceptor';
import { RateLimitInterceptor } from './core/interceptors/RateLimitInterceptor';

import { ENVIRONMENTS_GATEWAY } from './core/gateways/IEnvironmentsGateway';
import { BackendEnvironmentsGateway } from './core/gateways/BackendEnvironmentsGateway.service';
import { LEDGER_GATEWAY } from './core/gateways/ILedgerGateway';
import { BackendLedgerGateway } from './core/gateways/BackendLedgerGateway.service';
import { OAUTH_GATEWAY } from './core/gateways/IOAuthGateway';
import { BackendOAuthGateway } from './core/gateways/BackendOAuthGateway.service';
import { RUNNERS_GATEWAY } from './core/gateways/IRunnersGateway';
import { BackendRunnersGateway } from './core/gateways/BackendRunnersGateway.service';
import { SCOPES_GATEWAY } from './core/gateways/IScopesGateway';
import { BackendScopesGateway } from './core/gateways/BackendScopesGateway.service';
import { SECRETS_GATEWAY } from './core/gateways/ISecretsGateway';
import { BackendSecretsGateway } from './core/gateways/BackendSecretsGateway.service';
import { VARIABLES_GATEWAY } from './core/gateways/IVariablesGateway';
import { BackendVariablesGateway } from './core/gateways/BackendVariablesGateway.service';
import { WORKFLOWS_GATEWAY } from './core/gateways/IWorkflowsGateway';
import { BackendWorkflowsGateway } from './core/gateways/BackendWorkflowsGateway.service';

import { routes } from './App.routes';

// One QueryClient for the whole app, with the same defaultOptions as the React app's QueryClient
// (see web/src/main.tsx) — this is a real parity decision, not just a default left in place.
// Per-feature Facades will call injectQuery/injectMutation against this, mirroring
// api/hooks.ts's useQuery/useMutation usage today.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideTanStackQuery(queryClient),
    provideHttpClient(withInterceptors([AuthInterceptor, RateLimitInterceptor])),

    // Every Facade/Component depends on the *interface* (the token on the left), never the
    // concrete class on the right — this is the exact seam every ASP.NET Core backend swap went
    // through, one resource at a time (see docs/Architecture.md's Gateway/Adapter pattern
    // section), and would go through again for any future backend change: swap the `useClass`
    // here, change nothing else in the app.
    { provide: VARIABLES_GATEWAY, useClass: BackendVariablesGateway },
    { provide: LEDGER_GATEWAY, useClass: BackendLedgerGateway },
    { provide: SECRETS_GATEWAY, useClass: BackendSecretsGateway },
    { provide: ENVIRONMENTS_GATEWAY, useClass: BackendEnvironmentsGateway },
    { provide: RUNNERS_GATEWAY, useClass: BackendRunnersGateway },
    { provide: SCOPES_GATEWAY, useClass: BackendScopesGateway },
    { provide: OAUTH_GATEWAY, useClass: BackendOAuthGateway },
    { provide: WORKFLOWS_GATEWAY, useClass: BackendWorkflowsGateway },
  ],
};
