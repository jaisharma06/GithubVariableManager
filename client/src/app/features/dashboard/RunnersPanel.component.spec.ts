import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GitHubApiError } from '../../core/gateways/GitHubApiError';
import { OAUTH_GATEWAY } from '../../core/gateways/IOAuthGateway';
import { RUNNERS_GATEWAY } from '../../core/gateways/IRunnersGateway';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import {
  ClearFakeSession,
  CreateFakeOAuthGateway,
  CreateFakeRunnersGateway,
  CreateFakeScopesGateway,
  ProvideTestQueryClient,
  SeedFakeSession,
} from '../../core/testing/TestDoubles';
import { WaitFor } from '../../core/testing/WaitFor';
import { RunnersPanelComponent } from './RunnersPanel.component';

describe('RunnersPanelComponent', () => {
  let fixture: ComponentFixture<RunnersPanelComponent>;
  let fakeRunnersGateway: ReturnType<typeof CreateFakeRunnersGateway>;

  beforeEach(async () => {
    SeedFakeSession();
    fakeRunnersGateway = CreateFakeRunnersGateway();

    await TestBed.configureTestingModule({
      imports: [RunnersPanelComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: RUNNERS_GATEWAY, useValue: fakeRunnersGateway },
        { provide: SCOPES_GATEWAY, useValue: CreateFakeScopesGateway() },
        { provide: OAUTH_GATEWAY, useValue: CreateFakeOAuthGateway() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RunnersPanelComponent);
    fixture.componentRef.setInput('scope', { org: 'acme-corp', repo: 'widgets' });
  });

  afterEach(() => ClearFakeSession());

  it('shows "No self-hosted runners assigned" when the list is empty', async () => {
    fakeRunnersGateway.ListRunners.and.resolveTo([]);
    // TanStack Angular Query runs outside NgZone — whenStable() can't observe the query
    // resolving, so poll for real. See core/testing/WaitFor.ts.
    await WaitFor(fixture, () => !fixture.nativeElement.querySelector('.animate-pulse'));

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No self-hosted runners assigned.');
  });

  it('shows the online/total count and per-runner status', async () => {
    fakeRunnersGateway.ListRunners.and.resolveTo([
      { id: 1, name: 'runner-a', os: 'linux', status: 'online', busy: false, labels: [] },
      { id: 2, name: 'runner-b', os: 'linux', status: 'online', busy: true, labels: [] },
      { id: 3, name: 'runner-c', os: 'linux', status: 'offline', busy: false, labels: [] },
    ]);
    await WaitFor(fixture, () => !fixture.nativeElement.querySelector('.animate-pulse'));

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('2/3 online');
    expect(text).toContain('runner-a');
    expect(text).toContain('busy');
    expect(text).toContain('offline');
  });

  it('shows "No access" when the backend classifies the error as locked', async () => {
    fakeRunnersGateway.ListRunners.and.rejectWith(new GitHubApiError('Forbidden', 403, true));
    await WaitFor(fixture, () => !fixture.nativeElement.querySelector('.animate-pulse'));

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No access to view runners here.');
  });

  it('does not show "No access" on a 403 the backend did not classify as locked, proving noAccess reads .locked not .status', async () => {
    fakeRunnersGateway.ListRunners.and.rejectWith(new GitHubApiError('Forbidden', 403, false));
    await WaitFor(fixture, () => !fixture.nativeElement.querySelector('.animate-pulse'));

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('No access to view runners here.');
  });
});
