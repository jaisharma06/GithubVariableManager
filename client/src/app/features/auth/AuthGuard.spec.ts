import { TestBed } from '@angular/core/testing';
import { UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { SCOPES_GATEWAY, type IScopesGateway } from '../../core/gateways/IScopesGateway';
import { AuthGuard } from './AuthGuard';

const STORAGE_KEY = 'ghvm.session';

describe('AuthGuard', () => {
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  function RunGuard() {
    // AuthGuard injects AuthService, which itself injects SCOPES_GATEWAY (to validate a token
    // during connect) — needs a stand-in even though this guard never calls it.
    const fakeScopesGateway = jasmine.createSpyObj<IScopesGateway>('IScopesGateway', [
      'GetViewer',
      'ListMyOrgs',
      'ListMyRepos',
      'ListOrgRepos',
      'GetAccountType',
    ]);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SCOPES_GATEWAY, useValue: fakeScopesGateway }],
    });
    return TestBed.runInInjectionContext(() =>
      AuthGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
  }

  it('allows activation when a session exists', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token: 'tok', method: 'pat', viewer: { login: 'octocat', avatarUrl: '' } }),
    );

    expect(RunGuard()).toBe(true);
  });

  it('redirects to /connect when there is no session', () => {
    expect(RunGuard()).toBeInstanceOf(UrlTree);
  });
});
