import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GitHubApiError } from '../../core/gateways/GitHubApiError';
import { RUNNERS_GATEWAY } from '../../core/gateways/IRunnersGateway';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import {
  ClearFakeSession,
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RunnersPanelComponent);
    fixture.componentRef.setInput('scope', { org: 'acme-corp', repo: 'widgets' });
  });

  afterEach(() => ClearFakeSession());

  it('shows "No self-hosted runners assigned" when the list is empty', async () => {
    fakeRunnersGateway.ListRepoRunners.and.resolveTo([]);
    // TanStack Angular Query runs outside NgZone — whenStable() can't observe the query
    // resolving, so poll for real. See core/testing/WaitFor.ts.
    await WaitFor(fixture, () => !fixture.nativeElement.querySelector('.animate-pulse'));

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No self-hosted runners assigned.');
  });

  it('shows the online/total count and per-runner status', async () => {
    fakeRunnersGateway.ListRepoRunners.and.resolveTo([
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

  it('shows "No access" on a 403/404 instead of a hard error', async () => {
    fakeRunnersGateway.ListRepoRunners.and.rejectWith(new GitHubApiError('Forbidden', 403));
    await WaitFor(fixture, () => !fixture.nativeElement.querySelector('.animate-pulse'));

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No access to view runners here.');
  });
});
