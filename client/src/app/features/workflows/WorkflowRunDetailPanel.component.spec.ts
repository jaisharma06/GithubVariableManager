import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { GitHubApiError } from '../../core/gateways/GitHubApiError';
import { OAUTH_GATEWAY } from '../../core/gateways/IOAuthGateway';
import { WORKFLOWS_GATEWAY } from '../../core/gateways/IWorkflowsGateway';
import type { WorkflowRun, WorkflowRunDetail } from '../../core/Types';
import {
  ClearFakeSession,
  CreateFakeOAuthGateway,
  CreateFakeWorkflowsGateway,
  ProvideTestQueryClient,
  SeedFakeSession,
} from '../../core/testing/TestDoubles';
import { WaitFor } from '../../core/testing/WaitFor';
import { WorkflowRunDetailPanelComponent } from './WorkflowRunDetailPanel.component';

const RUN: WorkflowRun = {
  id: 101,
  name: 'CI',
  status: 'completed',
  conclusion: 'success',
  runNumber: 42,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:05:00Z',
  htmlUrl: 'https://github.com/acme-corp/widgets/actions/runs/101',
  commitMessage: 'Fix bug in parser',
};

const DETAIL: WorkflowRunDetail = {
  id: 101,
  name: 'CI',
  displayTitle: 'Fix bug in parser',
  commitMessage: 'Fix bug in parser',
  status: 'completed',
  conclusion: 'failure',
  event: 'push',
  runNumber: 42,
  runAttempt: 2,
  headBranch: 'main',
  headSha: 'a1b2c3d4e5f6',
  actorLogin: 'octocat',
  actorAvatarUrl: 'https://avatars.githubusercontent.com/u/1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:05:00Z',
  runStartedAt: '2026-01-01T00:00:30Z',
  htmlUrl: 'https://github.com/acme-corp/widgets/actions/runs/101',
  jobs: [
    {
      id: 9001,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      startedAt: '2026-01-01T00:00:30Z',
      completedAt: '2026-01-01T00:01:34Z',
      steps: [
        {
          name: 'Set up job',
          number: 1,
          status: 'completed',
          conclusion: 'success',
          startedAt: '2026-01-01T00:00:30Z',
          completedAt: '2026-01-01T00:00:32Z',
        },
        {
          name: 'Run tests',
          number: 2,
          status: 'completed',
          conclusion: 'success',
          startedAt: '2026-01-01T00:00:32Z',
          completedAt: '2026-01-01T00:01:34Z',
        },
      ],
    },
    {
      id: 9002,
      name: 'publish',
      status: 'completed',
      conclusion: 'failure',
      startedAt: '2026-01-01T00:01:34Z',
      completedAt: '2026-01-01T00:02:00Z',
      steps: [
        {
          name: 'Push package',
          number: 1,
          status: 'completed',
          conclusion: 'failure',
          startedAt: '2026-01-01T00:01:34Z',
          completedAt: '2026-01-01T00:02:00Z',
        },
      ],
    },
  ],
};

describe('WorkflowRunDetailPanelComponent', () => {
  let fixture: ComponentFixture<WorkflowRunDetailPanelComponent>;
  let fakeWorkflowsGateway: ReturnType<typeof CreateFakeWorkflowsGateway>;

  async function CreateFixture(): Promise<ComponentFixture<WorkflowRunDetailPanelComponent>> {
    await TestBed.configureTestingModule({
      imports: [WorkflowRunDetailPanelComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: WORKFLOWS_GATEWAY, useValue: fakeWorkflowsGateway },
        { provide: OAUTH_GATEWAY, useValue: CreateFakeOAuthGateway() },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(WorkflowRunDetailPanelComponent);
    f.componentRef.setInput('org', 'acme-corp');
    f.componentRef.setInput('repo', 'widgets');
    f.componentRef.setInput('run', RUN);
    f.detectChanges();
    return f;
  }

  function Text(f: ComponentFixture<unknown>): string {
    return (f.nativeElement as HTMLElement).textContent ?? '';
  }

  function FindButtonByText(f: ComponentFixture<unknown>, text: string): HTMLButtonElement {
    return Array.from(f.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === text,
    )!;
  }

  beforeEach(() => {
    SeedFakeSession();
    fakeWorkflowsGateway = CreateFakeWorkflowsGateway();
    fakeWorkflowsGateway.GetWorkflowRunDetail.and.resolveTo(DETAIL);
  });

  afterEach(() => ClearFakeSession());

  describe('once the detail query resolves', () => {
    beforeEach(async () => {
      fixture = await CreateFixture();
      await WaitFor(fixture, () => Text(fixture).includes('build'));
    });

    it('renders the run summary — commit message, run number, attempt, event, branch, sha and actor', () => {
      const text = Text(fixture);
      expect(text).toContain('Fix bug in parser');
      expect(text).toContain('#42');
      expect(text).toContain('Attempt 2');
      expect(text).toContain('push');
      expect(text).toContain('main');
      expect(text).toContain('a1b2c3d'); // short sha, not the full 12 characters
      expect(text).toContain('octocat');
    });

    it('renders every job with its status and duration', () => {
      const text = Text(fixture);
      expect(text).toContain('build');
      expect(text).toContain('publish');
      expect(text).toContain('Failure');
      expect(text).toContain('1m 4s'); // build: 00:00:30 → 00:01:34
    });

    it('opens a job that did not finish cleanly and leaves a clean one collapsed', () => {
      // 'publish' failed, so its steps are visible without interaction; 'build' succeeded, so it isn't.
      expect(Text(fixture)).toContain('Push package');
      expect(Text(fixture)).not.toContain('Run tests');
    });

    it('reveals a collapsed job’s steps when its header is clicked', () => {
      const jobHeader = Array.from(fixture.nativeElement.querySelectorAll('button[aria-expanded]') as NodeListOf<HTMLButtonElement>).find(
        (b) => b.textContent?.includes('build'),
      )!;
      expect(jobHeader.getAttribute('aria-expanded')).toBe('false');

      jobHeader.click();
      fixture.detectChanges();

      expect(jobHeader.getAttribute('aria-expanded')).toBe('true');
      const text = Text(fixture);
      expect(text).toContain('Set up job');
      expect(text).toContain('Run tests');
    });

    it('keeps a clean step’s status readable to screen readers while hiding it visually', () => {
      const jobHeader = Array.from(fixture.nativeElement.querySelectorAll('button[aria-expanded]') as NodeListOf<HTMLButtonElement>).find(
        (b) => b.textContent?.includes('build'),
      )!;
      jobHeader.click();
      fixture.detectChanges();

      // 'Run tests' succeeded: its label is present in the DOM but visually hidden, so 15 rows of
      // "Success" don't drown out the one row that isn't.
      const rows = Array.from(fixture.nativeElement.querySelectorAll('div[id^="workflow-job-steps-"] > div') as NodeListOf<HTMLElement>);
      const runTestsRow = rows.find((row) => row.textContent?.includes('Run tests'))!;
      expect(runTestsRow.querySelector('.sr-only')?.textContent?.trim()).toBe('Success');
    });

    it('links out to the run on GitHub', () => {
      const link = fixture.nativeElement.querySelector(`a[href="${RUN.htmlUrl}"]`) as HTMLAnchorElement;
      expect(link).toBeTruthy();
      expect(link.textContent).toContain('View on GitHub');
    });

    it('emits closed when the close button is clicked', () => {
      const closedSpy = jasmine.createSpy('closed');
      fixture.componentInstance.closed.subscribe(closedSpy);

      (fixture.nativeElement.querySelector('button[aria-label="Close run detail"]') as HTMLButtonElement).click();

      expect(closedSpy).toHaveBeenCalled();
    });

    it(
      'reruns the run and confirms it inline',
      fakeAsync(() => {
        fakeWorkflowsGateway.RerunWorkflowRun.and.resolveTo();

        FindButtonByText(fixture, 'Rerun').click();
        tick();
        fixture.detectChanges();

        expect(fakeWorkflowsGateway.RerunWorkflowRun).toHaveBeenCalledWith('acme-corp', 'widgets', RUN.id);
        expect(Text(fixture)).toContain('Rerun started');
      }),
    );

    it(
      'explains a permission-denied rerun in terms of write access',
      fakeAsync(() => {
        fakeWorkflowsGateway.RerunWorkflowRun.and.rejectWith(new GitHubApiError('Forbidden', 403));

        FindButtonByText(fixture, 'Rerun').click();
        tick();
        fixture.detectChanges();

        const text = Text(fixture);
        expect(text).toContain('rerunning a workflow requires write access to this repository');
        expect(text).not.toContain('Rerun started');
      }),
    );

    it(
      'surfaces a non-permission rerun failure with GitHub’s own message',
      fakeAsync(() => {
        fakeWorkflowsGateway.RerunWorkflowRun.and.rejectWith(new GitHubApiError('Run is already in progress', 409));

        FindButtonByText(fixture, 'Rerun').click();
        tick();
        fixture.detectChanges();

        expect(Text(fixture)).toContain('Run is already in progress');
      }),
    );
  });

  it('shows the clicked run’s own summary while the detail query is still loading', async () => {
    // A never-resolving detail request holds the panel in its loading state.
    fakeWorkflowsGateway.GetWorkflowRunDetail.and.returnValue(new Promise<WorkflowRunDetail>(() => undefined));
    fixture = await CreateFixture();

    expect(fixture.nativeElement.querySelector('.animate-pulse')).toBeTruthy();
    // The header never renders empty — it falls back to the row the user clicked.
    const text = Text(fixture);
    expect(text).toContain('Fix bug in parser');
    expect(text).toContain('#42');
  });

  it('reports a failed detail query instead of an empty job list', async () => {
    fakeWorkflowsGateway.GetWorkflowRunDetail.and.rejectWith(new GitHubApiError('Forbidden', 403));
    fixture = await CreateFixture();

    await WaitFor(fixture, () => Text(fixture).includes('access to this repository'));

    expect(Text(fixture)).toContain('reading this run’s jobs needs access to this repository');
  });

  it('says so plainly when GitHub reports no jobs yet', async () => {
    fakeWorkflowsGateway.GetWorkflowRunDetail.and.resolveTo({ ...DETAIL, jobs: [] });
    fixture = await CreateFixture();

    await WaitFor(fixture, () => Text(fixture).includes('hasn’t reported any jobs'));

    expect(Text(fixture)).toContain('hasn’t reported any jobs for this run yet');
  });
});
