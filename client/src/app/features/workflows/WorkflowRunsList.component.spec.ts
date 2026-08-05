import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { WorkflowRun } from '../../core/Types';
import { WorkflowRunsListComponent } from './WorkflowRunsList.component';

const SUCCESS_RUN: WorkflowRun = {
  id: 1,
  name: 'CI',
  status: 'completed',
  conclusion: 'success',
  runNumber: 42,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:05:00Z',
  htmlUrl: 'https://github.com/acme-corp/widgets/actions/runs/1',
};

const IN_PROGRESS_RUN: WorkflowRun = {
  ...SUCCESS_RUN,
  id: 2,
  status: 'in_progress',
  conclusion: null,
  runNumber: 43,
};

const FAILED_RUN: WorkflowRun = {
  ...SUCCESS_RUN,
  id: 3,
  status: 'completed',
  conclusion: 'failure',
  runNumber: 44,
};

describe('WorkflowRunsListComponent', () => {
  let fixture: ComponentFixture<WorkflowRunsListComponent>;

  async function CreateFixture(
    runs: WorkflowRun[],
    deletingRunId: number | null = null,
    selectedRunIds: ReadonlySet<number> = new Set(),
  ): Promise<ComponentFixture<WorkflowRunsListComponent>> {
    await TestBed.configureTestingModule({ imports: [WorkflowRunsListComponent] }).compileComponents();
    const f = TestBed.createComponent(WorkflowRunsListComponent);
    f.componentRef.setInput('runs', runs);
    f.componentRef.setInput('deletingRunId', deletingRunId);
    f.componentRef.setInput('selectedRunIds', selectedRunIds);
    f.detectChanges();
    return f;
  }

  function SelectAllCheckbox(fixture: ComponentFixture<WorkflowRunsListComponent>): HTMLInputElement {
    return fixture.nativeElement.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement;
  }

  function RowCheckboxes(fixture: ComponentFixture<WorkflowRunsListComponent>): HTMLInputElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>).slice(1);
  }

  it('shows an empty state when there are no runs', async () => {
    fixture = await CreateFixture([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No runs yet');
  });

  it('shows run number, status label, and dates for each run', async () => {
    fixture = await CreateFixture([SUCCESS_RUN]);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('#42');
    expect(text).toContain('Success');
  });

  it('labels an in-progress run by its status, not a conclusion', async () => {
    fixture = await CreateFixture([IN_PROGRESS_RUN]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('In progress');
  });

  it('labels a failed run distinctly from a successful one', async () => {
    fixture = await CreateFixture([FAILED_RUN]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Failure');
  });

  it('emits deleteRun with the clicked run', async () => {
    fixture = await CreateFixture([SUCCESS_RUN]);
    const deleteSpy = jasmine.createSpy('deleteRun');
    fixture.componentInstance.deleteRun.subscribe(deleteSpy);

    const button = fixture.nativeElement.querySelector('button[title="Delete this run"]') as HTMLButtonElement;
    button.click();

    expect(deleteSpy).toHaveBeenCalledWith(SUCCESS_RUN);
  });

  it('disables the delete button for the run currently being deleted', async () => {
    fixture = await CreateFixture([SUCCESS_RUN], SUCCESS_RUN.id);
    const button = fixture.nativeElement.querySelector('button[title="Delete this run"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('leaves the select-all checkbox unchecked and not indeterminate when nothing is selected', async () => {
    fixture = await CreateFixture([SUCCESS_RUN, FAILED_RUN], null, new Set());
    const selectAll = SelectAllCheckbox(fixture);
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(false);
  });

  it('checks the select-all checkbox (not indeterminate) when every visible run is selected', async () => {
    fixture = await CreateFixture([SUCCESS_RUN, FAILED_RUN], null, new Set([SUCCESS_RUN.id, FAILED_RUN.id]));
    const selectAll = SelectAllCheckbox(fixture);
    expect(selectAll.checked).toBe(true);
    expect(selectAll.indeterminate).toBe(false);
  });

  it('marks the select-all checkbox indeterminate for a strict non-empty subset', async () => {
    fixture = await CreateFixture([SUCCESS_RUN, FAILED_RUN], null, new Set([SUCCESS_RUN.id]));
    const selectAll = SelectAllCheckbox(fixture);
    expect(selectAll.indeterminate).toBe(true);
  });

  it('emits toggleRun with the clicked row id', async () => {
    fixture = await CreateFixture([SUCCESS_RUN, FAILED_RUN]);
    const toggleSpy = jasmine.createSpy('toggleRun');
    fixture.componentInstance.toggleRun.subscribe(toggleSpy);

    RowCheckboxes(fixture)[1].dispatchEvent(new Event('change'));

    expect(toggleSpy).toHaveBeenCalledWith(FAILED_RUN.id);
  });

  it('emits toggleSelectAll when the header checkbox changes', async () => {
    fixture = await CreateFixture([SUCCESS_RUN, FAILED_RUN]);
    const toggleAllSpy = jasmine.createSpy('toggleSelectAll');
    fixture.componentInstance.toggleSelectAll.subscribe(toggleAllSpy);

    SelectAllCheckbox(fixture).dispatchEvent(new Event('change'));

    expect(toggleAllSpy).toHaveBeenCalled();
  });

  it('reflects selectedRunIds membership per row', async () => {
    fixture = await CreateFixture([SUCCESS_RUN, FAILED_RUN], null, new Set([FAILED_RUN.id]));
    const rows = RowCheckboxes(fixture);
    expect(rows[0].checked).toBe(false);
    expect(rows[1].checked).toBe(true);
  });
});
