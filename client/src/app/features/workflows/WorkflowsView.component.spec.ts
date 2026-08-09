import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { GitHubApiError } from '../../core/gateways/GitHubApiError';
import { OAUTH_GATEWAY } from '../../core/gateways/IOAuthGateway';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import { WORKFLOWS_GATEWAY } from '../../core/gateways/IWorkflowsGateway';
import type { GithubWorkflow, WorkflowRun } from '../../core/Types';
import {
  ClearFakeSession,
  CreateFakeOAuthGateway,
  CreateFakeScopesGateway,
  CreateFakeWorkflowsGateway,
  ProvideTestQueryClient,
  SeedFakeSession,
} from '../../core/testing/TestDoubles';
import { WaitFor } from '../../core/testing/WaitFor';
import { WorkflowsViewComponent } from './WorkflowsView.component';

const WORKFLOW: GithubWorkflow = { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' };

const RUN_1: WorkflowRun = {
  id: 101,
  name: 'CI',
  status: 'completed',
  conclusion: 'success',
  runNumber: 5,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:05:00Z',
  htmlUrl: 'https://github.com/acme-corp/widgets/actions/runs/101',
  commitMessage: 'Fix bug in parser',
};

const RUN_2: WorkflowRun = { ...RUN_1, id: 102, runNumber: 4 };

// Mirrors WorkflowsFacade.ts's private WORKFLOW_CLEANUP_POLL_INTERVAL_MS — not exported, so kept in
// sync here the same way OAuthDeviceFlow.component.spec.ts hardcodes FAKE_DEVICE.interval * 1000.
const WORKFLOW_CLEANUP_POLL_INTERVAL_MS = 500;

describe('WorkflowsViewComponent', () => {
  let fixture: ComponentFixture<WorkflowsViewComponent>;
  let fakeWorkflowsGateway: ReturnType<typeof CreateFakeWorkflowsGateway>;

  // Query loads (workflows list, then the selected workflow's runs) genuinely resolve outside
  // NgZone — see core/testing/README.md — so this setup uses real WaitFor polling in an `async`
  // beforeEach, the same hybrid structure CompareView.component.spec.ts uses (async beforeEach +
  // fakeAsync individual `it`s): once the fixture here is fully settled, the delete tests below
  // can safely use fakeAsync()/tick() for the mutation-driven flow that follows.
  beforeEach(async () => {
    SeedFakeSession();
    fakeWorkflowsGateway = CreateFakeWorkflowsGateway();
    fakeWorkflowsGateway.ListWorkflows.and.resolveTo([WORKFLOW]);
    fakeWorkflowsGateway.ListWorkflowRuns.and.resolveTo([RUN_1, RUN_2]);

    await TestBed.configureTestingModule({
      imports: [WorkflowsViewComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: WORKFLOWS_GATEWAY, useValue: fakeWorkflowsGateway },
        { provide: SCOPES_GATEWAY, useValue: CreateFakeScopesGateway() },
        { provide: OAUTH_GATEWAY, useValue: CreateFakeOAuthGateway() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkflowsViewComponent);
    fixture.componentRef.setInput('org', 'acme-corp');
    fixture.componentRef.setInput('repo', 'widgets');
    await WaitFor(fixture, () => !fixture.nativeElement.querySelector('.animate-pulse'));

    const workflowButton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    workflowButton.click();
    fixture.detectChanges();
    await WaitFor(fixture, () => !fixture.nativeElement.querySelector('.animate-pulse'));
  });

  afterEach(() => ClearFakeSession());

  it('lists workflows for the repo', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('CI');
    expect(text).toContain('.github/workflows/ci.yml');
  });

  it("shows the selected workflow's runs", () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('#5');
    expect(text).toContain('#4');
  });

  it('starts with "Delete selected" disabled, enabling once a run is checked', () => {
    const deleteSelectedButton = FindButtonByText(fixture, 'Delete selected');
    expect(deleteSelectedButton.disabled).toBe(true);

    CheckRun(fixture, RUN_1.id);
    fixture.detectChanges();

    expect(deleteSelectedButton.disabled).toBe(false);
  });

  it('opens the delete confirmation with a live selected count and the irreversibility/reappearance warnings', () => {
    CheckRun(fixture, RUN_1.id);
    CheckRun(fixture, RUN_2.id);
    fixture.detectChanges();

    FindButtonByText(fixture, 'Delete selected').click();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Delete 2 runs?');
    expect(text).toContain('can’t be undone');
    expect(text).toContain('only clears run history');
    expect(text).toContain('may list this workflow again');
  });

  it('shows a singular title when exactly one run is selected', () => {
    CheckRun(fixture, RUN_1.id);
    fixture.detectChanges();

    FindButtonByText(fixture, 'Delete selected').click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Delete 1 run?');
  });

  it(
    'deletes a single run',
    fakeAsync(() => {
      fakeWorkflowsGateway.DeleteWorkflowRun.and.resolveTo();
      const deleteButton = fixture.nativeElement.querySelector('button[title="Delete this run"]') as HTMLButtonElement;
      deleteButton.click();
      tick();
      fixture.detectChanges();

      expect(fakeWorkflowsGateway.DeleteWorkflowRun).toHaveBeenCalledWith('acme-corp', 'widgets', RUN_1.id);
    }),
  );

  it(
    'surfaces a clear permission error when a single-run delete 403s',
    fakeAsync(() => {
      fakeWorkflowsGateway.DeleteWorkflowRun.and.rejectWith(new GitHubApiError('Forbidden', 403));
      const deleteButton = fixture.nativeElement.querySelector('button[title="Delete this run"]') as HTMLButtonElement;
      deleteButton.click();
      tick();
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('requires write access to this repository');
    }),
  );

  it(
    'deletes only the checked runs on confirm and closes the dialog',
    fakeAsync(() => {
      fakeWorkflowsGateway.StartRunCleanup.and.resolveTo('job-1');
      fakeWorkflowsGateway.PollRunCleanup.and.resolveTo({
        done: 1,
        total: 1,
        completed: true,
        succeededIds: [RUN_1.id],
        failedIds: [],
        permissionDenied: false,
      });
      CheckRun(fixture, RUN_1.id);
      fixture.detectChanges();

      FindButtonByText(fixture, 'Delete selected').click();
      fixture.detectChanges();

      FindButtonByText(fixture, 'Delete runs').click();
      tick(); // StartRunCleanup resolves
      tick(); // first PollRunCleanup resolves
      fixture.detectChanges();

      expect(fakeWorkflowsGateway.StartRunCleanup).toHaveBeenCalledWith('acme-corp', 'widgets', WORKFLOW.id, [RUN_1.id]);
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Delete 1 run?');
    }),
  );

  it(
    'reports a partial failure without closing the dialog, flagging a permission problem, and narrows a retry to just the failed run',
    fakeAsync(() => {
      fakeWorkflowsGateway.StartRunCleanup.and.resolveTo('job-1');
      fakeWorkflowsGateway.PollRunCleanup.and.resolveTo({
        done: 2,
        total: 2,
        completed: true,
        succeededIds: [RUN_1.id],
        failedIds: [RUN_2.id],
        permissionDenied: true,
      });
      CheckRun(fixture, RUN_1.id);
      CheckRun(fixture, RUN_2.id);
      fixture.detectChanges();

      FindButtonByText(fixture, 'Delete selected').click();
      fixture.detectChanges();

      FindButtonByText(fixture, 'Delete runs').click();
      tick(); // StartRunCleanup resolves
      tick(); // first PollRunCleanup resolves
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Deleted 1 of 2 runs');
      expect(text).toContain('write access to this repository is required');
      expect(text).toContain('Delete 1 run?');

      fakeWorkflowsGateway.StartRunCleanup.calls.reset();
      fakeWorkflowsGateway.StartRunCleanup.and.resolveTo('job-2');
      fakeWorkflowsGateway.PollRunCleanup.and.resolveTo({
        done: 1,
        total: 1,
        completed: true,
        succeededIds: [RUN_2.id],
        failedIds: [],
        permissionDenied: false,
      });
      FindButtonByText(fixture, 'Delete runs').click();
      tick(); // StartRunCleanup resolves
      tick(); // first PollRunCleanup resolves
      fixture.detectChanges();

      expect(fakeWorkflowsGateway.StartRunCleanup).toHaveBeenCalledTimes(1);
      expect(fakeWorkflowsGateway.StartRunCleanup).toHaveBeenCalledWith('acme-corp', 'widgets', WORKFLOW.id, [RUN_2.id]);
    }),
  );

  it(
    'reports live incremental progress across multiple polls before completion',
    fakeAsync(() => {
      fakeWorkflowsGateway.StartRunCleanup.and.resolveTo('job-1');
      fakeWorkflowsGateway.PollRunCleanup.and.resolveTo({
        done: 0,
        total: 2,
        completed: false,
        succeededIds: [],
        failedIds: [],
        permissionDenied: false,
      });
      CheckRun(fixture, RUN_1.id);
      CheckRun(fixture, RUN_2.id);
      fixture.detectChanges();

      FindButtonByText(fixture, 'Delete selected').click();
      fixture.detectChanges();

      FindButtonByText(fixture, 'Delete runs').click();
      tick(); // StartRunCleanup resolves
      tick(); // first PollRunCleanup resolves (still in progress)
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Deleting 0 of 2');

      fakeWorkflowsGateway.PollRunCleanup.and.resolveTo({
        done: 2,
        total: 2,
        completed: true,
        succeededIds: [RUN_1.id, RUN_2.id],
        failedIds: [],
        permissionDenied: false,
      });
      tick(WORKFLOW_CLEANUP_POLL_INTERVAL_MS); // Delay fires, next PollRunCleanup resolves
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Delete 2 runs?');
    }),
  );

  it('selects and clears every visible run via the select-all checkbox', () => {
    const selectAll = fixture.nativeElement.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement;

    selectAll.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const rowCheckboxes = Array.from(
      fixture.nativeElement.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>,
    ).slice(1);
    expect(rowCheckboxes.every((c) => c.checked)).toBe(true);
    expect(FindButtonByText(fixture, 'Delete selected').disabled).toBe(false);

    selectAll.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const rowCheckboxesAfter = Array.from(
      fixture.nativeElement.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>,
    ).slice(1);
    expect(rowCheckboxesAfter.every((c) => !c.checked)).toBe(true);
    expect(FindButtonByText(fixture, 'Delete selected').disabled).toBe(true);
  });
});

function FindButtonByText(fixture: ComponentFixture<unknown>, text: string): HTMLButtonElement {
  return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
    (b) => b.textContent?.trim() === text,
  )!;
}

function CheckRun(fixture: ComponentFixture<unknown>, runId: number): void {
  const runs: WorkflowRun[] = [RUN_1, RUN_2];
  const rowIndex = runs.findIndex((r) => r.id === runId);
  const checkbox = (fixture.nativeElement.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>)[rowIndex + 1];
  checkbox.dispatchEvent(new Event('change'));
}
