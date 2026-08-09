// Shared test-only helpers. Every Facade (core/facades/*.ts) calls injectQuery/injectMutation/
// injectQueryClient, all of which need a QueryClient in scope — and most Facades sit behind
// AuthService, which needs SCOPES_GATEWAY. Rather than every spec re-deriving "what does this
// component transitively need just to construct", these two helpers cover the two dependencies
// that recur across nearly every component spec from Phase 4 onward.
import type { Provider } from '@angular/core';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import type { IEnvironmentsGateway } from '../gateways/IEnvironmentsGateway';
import type { ILedgerGateway } from '../gateways/ILedgerGateway';
import type { IOAuthGateway } from '../gateways/IOAuthGateway';
import type { IRunnersGateway } from '../gateways/IRunnersGateway';
import type { IScopesGateway } from '../gateways/IScopesGateway';
import type { ISecretsGateway } from '../gateways/ISecretsGateway';
import type { IVariablesGateway } from '../gateways/IVariablesGateway';
import type { IWorkflowsGateway } from '../gateways/IWorkflowsGateway';

const SESSION_STORAGE_KEY = 'ghvm.session';

/**
 * Seeds a fake authenticated AuthService session directly via localStorage — AuthService reads
 * this synchronously when it's first constructed, so call this *before* `TestBed.createComponent`
 * for any component whose Facades gate a query behind `enabled: !!authService.token()` (which is
 * most of them — every Facade in core/facades/ does this). Pair with ClearFakeSession() in an
 * afterEach so one spec's fake session can't leak into another.
 */
export function SeedFakeSession(): void {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ token: 'test-token', method: 'pat', viewer: { login: 'octocat', avatarUrl: '' } }),
  );
}

export function ClearFakeSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

/**
 * A fresh QueryClient, provided the same way App.config.ts does it for the real app — retries
 * disabled so a spec that intentionally fails a query (e.g. a 403 test) doesn't sit through
 * TanStack Query's default retry/backoff before the assertion runs.
 */
export function ProvideTestQueryClient(): Provider {
  return provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
}

export function CreateFakeScopesGateway(): jasmine.SpyObj<IScopesGateway> {
  return jasmine.createSpyObj<IScopesGateway>('IScopesGateway', [
    'ListMyOrgs',
    'ListMyRepos',
    'ListOrgRepos',
    'GetAccountType',
  ]);
}

export function CreateFakeEnvironmentsGateway(): jasmine.SpyObj<IEnvironmentsGateway> {
  return jasmine.createSpyObj<IEnvironmentsGateway>('IEnvironmentsGateway', [
    'ListEnvironments',
    'CreateEnvironment',
    'DeleteEnvironment',
    'RenameEnvironment',
  ]);
}

export function CreateFakeVariablesGateway(): jasmine.SpyObj<IVariablesGateway> {
  return jasmine.createSpyObj<IVariablesGateway>('IVariablesGateway', [
    'CreateVariable',
    'UpdateVariable',
    'DeleteVariable',
  ]);
}

export function CreateFakeLedgerGateway(): jasmine.SpyObj<ILedgerGateway> {
  return jasmine.createSpyObj<ILedgerGateway>('ILedgerGateway', ['GetLedger', 'Copy', 'DeleteEverywhere']);
}

export function CreateFakeSecretsGateway(): jasmine.SpyObj<ISecretsGateway> {
  return jasmine.createSpyObj<ISecretsGateway>('ISecretsGateway', ['PutSecret', 'RenameSecret', 'DeleteSecret']);
}

export function CreateFakeRunnersGateway(): jasmine.SpyObj<IRunnersGateway> {
  return jasmine.createSpyObj<IRunnersGateway>('IRunnersGateway', ['ListRunners']);
}

export function CreateFakeOAuthGateway(): jasmine.SpyObj<IOAuthGateway> {
  return jasmine.createSpyObj<IOAuthGateway>('IOAuthGateway', [
    'FetchOAuthClientId',
    'StartDeviceFlow',
    'PollDeviceToken',
    'GetViewer',
  ]);
}

export function CreateFakeWorkflowsGateway(): jasmine.SpyObj<IWorkflowsGateway> {
  return jasmine.createSpyObj<IWorkflowsGateway>('IWorkflowsGateway', [
    'ListWorkflows',
    'ListWorkflowRuns',
    'DeleteWorkflowRun',
    'StartRunCleanup',
    'PollRunCleanup',
  ]);
}
