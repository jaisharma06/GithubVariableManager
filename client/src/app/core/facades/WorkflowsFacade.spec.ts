import { AllRunsSettled } from './WorkflowsFacade';
import type { WorkflowRun } from '../Types';

function MakeRun(status: string | null): WorkflowRun {
  return {
    id: 1,
    name: 'CI',
    status,
    conclusion: null,
    runNumber: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    htmlUrl: 'https://github.com/example/example/actions/runs/1',
  };
}

/**
 * Direct unit coverage for the one new piece of real decision logic in WorkflowsFacade's
 * conditional polling (see the class doc comment) — pure and trivially testable with no TanStack
 * Query timer machinery involved, matching this codebase's convention of extracting pure decision
 * logic (LedgerSupport, CopySupport) for direct testability.
 */
describe('AllRunsSettled', () => {
  it('treats undefined data (query not yet loaded) as settled, so no poll starts before data exists', () => {
    expect(AllRunsSettled(undefined)).toBe(true);
  });

  it('treats an empty run list as settled', () => {
    expect(AllRunsSettled([])).toBe(true);
  });

  it('is settled when every run has status "completed"', () => {
    expect(AllRunsSettled([MakeRun('completed'), MakeRun('completed')])).toBe(true);
  });

  it('is not settled when any run is still in flight (e.g. "in_progress" or "queued")', () => {
    expect(AllRunsSettled([MakeRun('completed'), MakeRun('in_progress')])).toBe(false);
    expect(AllRunsSettled([MakeRun('queued')])).toBe(false);
  });
});
