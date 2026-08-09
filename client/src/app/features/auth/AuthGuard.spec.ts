import { TestBed } from '@angular/core/testing';
import { UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { OAUTH_GATEWAY, type IOAuthGateway } from '../../core/gateways/IOAuthGateway';
import { AuthGuard } from './AuthGuard';

const STORAGE_KEY = 'ghvm.session';

describe('AuthGuard', () => {
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  function RunGuard() {
    // AuthGuard injects AuthService, which itself injects OAUTH_GATEWAY (to validate a token
    // during connect) — needs a stand-in even though this guard never calls it.
    const fakeOAuthGateway = jasmine.createSpyObj<IOAuthGateway>('IOAuthGateway', [
      'FetchOAuthClientId',
      'StartDeviceFlow',
      'PollDeviceToken',
      'GetViewer',
    ]);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: OAUTH_GATEWAY, useValue: fakeOAuthGateway }],
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
