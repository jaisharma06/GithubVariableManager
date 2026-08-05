import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';

import { AuthInterceptor } from './core/interceptors/AuthInterceptor';
import { RateLimitInterceptor } from './core/interceptors/RateLimitInterceptor';

import { ENVIRONMENTS_GATEWAY } from './core/gateways/IEnvironmentsGateway';
import { GithubEnvironmentsGateway } from './core/gateways/GithubEnvironmentsGateway.service';
import { OAUTH_GATEWAY } from './core/gateways/IOAuthGateway';
import { LocalOAuthGateway } from './core/gateways/LocalOAuthGateway.service';
import { RUNNERS_GATEWAY } from './core/gateways/IRunnersGateway';
import { GithubRunnersGateway } from './core/gateways/GithubRunnersGateway.service';
import { SCOPES_GATEWAY } from './core/gateways/IScopesGateway';
import { GithubScopesGateway } from './core/gateways/GithubScopesGateway.service';
import { SECRETS_GATEWAY } from './core/gateways/ISecretsGateway';
import { GithubSecretsGateway } from './core/gateways/GithubSecretsGateway.service';
import { VARIABLES_GATEWAY } from './core/gateways/IVariablesGateway';
import { GithubVariablesGateway } from './core/gateways/GithubVariablesGateway.service';

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
    // concrete class on the right — this is the entire seam a future ASP.NET Core backend swap
    // goes through (see docs/Architecture.md's Gateway/Adapter pattern section): swap the
    // `useClass` here, change nothing else in the app.
    { provide: VARIABLES_GATEWAY, useClass: GithubVariablesGateway },
    { provide: SECRETS_GATEWAY, useClass: GithubSecretsGateway },
    { provide: ENVIRONMENTS_GATEWAY, useClass: GithubEnvironmentsGateway },
    { provide: RUNNERS_GATEWAY, useClass: GithubRunnersGateway },
    { provide: SCOPES_GATEWAY, useClass: GithubScopesGateway },
    { provide: OAUTH_GATEWAY, useClass: LocalOAuthGateway },
  ],
};
