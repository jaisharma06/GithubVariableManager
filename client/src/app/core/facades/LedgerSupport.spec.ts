// Pure-function tests for the composite-variable helpers added to LedgerSupport.ts. No Angular
// TestBed needed — these are plain, DI-free functions, same testing shape this file's other
// exports (SameScope, OptimisticVariable, …) would get if they had dedicated specs.
import type { LedgerItem } from '../Types';
import { ExtractReferences, FindDependents, IsCompositeValue } from './LedgerSupport';

function MakeVariable(name: string, value: string, scope: LedgerItem['scope'], level: LedgerItem['level'] = 'repository'): LedgerItem {
  return {
    id: `variable:${level}:${scope.org}:${scope.repo ?? ''}:${scope.env ?? ''}:${name}`,
    kind: 'variable',
    level,
    scope,
    name,
    value,
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2020-01-01T00:00:00Z',
  };
}

describe('IsCompositeValue', () => {
  it('is true for a value containing a $(NAME) reference', () => {
    expect(IsCompositeValue('$(BASE_URL)/cdn')).toBeTrue();
  });

  it('is false for a plain value', () => {
    expect(IsCompositeValue('just-a-value')).toBeFalse();
  });

  it('does not falsely match parens without a leading dollar sign', () => {
    expect(IsCompositeValue('(BASE_URL)/cdn')).toBeFalse();
  });

  it('stays correct across repeated calls (no global-regex lastIndex leakage)', () => {
    expect(IsCompositeValue('$(A)')).toBeTrue();
    expect(IsCompositeValue('$(A)')).toBeTrue();
    expect(IsCompositeValue('$(A)')).toBeTrue();
  });
});

describe('ExtractReferences', () => {
  it('returns each distinct reference name once', () => {
    expect(ExtractReferences('$(A)/$(B)/$(A)')).toEqual(['A', 'B']);
  });

  it('returns an empty array for a plain value', () => {
    expect(ExtractReferences('plain')).toEqual([]);
  });
});

describe('FindDependents', () => {
  const org = { org: 'octo-org' };
  const repo = { org: 'octo-org', repo: 'widgets' };
  const prodEnv = { org: 'octo-org', repo: 'widgets', env: 'prod' };
  const stagingEnv = { org: 'octo-org', repo: 'widgets', env: 'staging' };
  const otherRepo = { org: 'octo-org', repo: 'other' };

  it('finds a repository-level composite referencing an organization-level target', () => {
    const items = [
      MakeVariable('BASE_URL', 'https://example.com', org, 'organization'),
      MakeVariable('CDN', '$(BASE_URL)/cdn', repo, 'repository'),
    ];

    const dependents = FindDependents(items, 'BASE_URL', org);

    expect(dependents.map((i) => i.name)).toEqual(['CDN']);
  });

  it('finds an environment-level composite referencing a repository-level target', () => {
    const items = [MakeVariable('CDN', '$(BASE_URL)/cdn', prodEnv, 'environment')];

    const dependents = FindDependents(items, 'BASE_URL', repo);

    expect(dependents.map((i) => i.name)).toEqual(['CDN']);
  });

  it('excludes an environment-level composite that is a different environment than the target', () => {
    const items = [MakeVariable('CDN', '$(BASE_URL)/cdn', stagingEnv, 'environment')];

    const dependents = FindDependents(items, 'BASE_URL', prodEnv);

    expect(dependents).toEqual([]);
  });

  it('excludes a same-named composite from an unrelated repo (no cross-repo reference possible)', () => {
    const items = [MakeVariable('CDN', '$(BASE_URL)/cdn', otherRepo, 'repository')];

    const dependents = FindDependents(items, 'BASE_URL', repo);

    expect(dependents).toEqual([]);
  });

  it('excludes a repository-level composite from seeing an environment-level target (wrong direction in the precedence chain)', () => {
    const items = [MakeVariable('CDN', '$(ENV_ONLY)/cdn', repo, 'repository')];

    const dependents = FindDependents(items, 'ENV_ONLY', prodEnv);

    expect(dependents).toEqual([]);
  });

  it('ignores a non-composite variable even if its value happens to contain the target name', () => {
    const items = [MakeVariable('PLAIN', 'BASE_URL', org, 'organization')];

    const dependents = FindDependents(items, 'BASE_URL', org);

    expect(dependents).toEqual([]);
  });

  it('excludes the target item itself', () => {
    const items = [MakeVariable('SELF', 'plain', org, 'organization')];

    const dependents = FindDependents(items, 'SELF', org);

    expect(dependents).toEqual([]);
  });
});
