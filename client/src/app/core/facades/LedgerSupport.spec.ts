// Pure-function tests for the composite-variable helpers added to LedgerSupport.ts. No Angular
// TestBed needed — these are plain, DI-free functions, same testing shape this file's other
// exports (SameScope, OptimisticVariable, …) would get if they had dedicated specs.
import type { LedgerItem } from '../Types';
import {
  DetectComposeTrigger,
  ExtractReferences,
  FindComposableCandidates,
  FindComposites,
  FindDependents,
  IsCompositeValue,
} from './LedgerSupport';

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

/**
 * `formula` (not `value`) is now what makes an item composite — `value` is always the real,
 * already-resolved GitHub literal. `FindDependents` reads `formula`, so every composite fixture in
 * this file needs one; the resolved literal itself is irrelevant to `FindDependents`'s own logic,
 * so it's just a fixed placeholder here.
 */
function MakeCompositeVariable(
  name: string,
  formula: string,
  scope: LedgerItem['scope'],
  level: LedgerItem['level'] = 'repository',
): LedgerItem {
  return { ...MakeVariable(name, 'resolved-literal', scope, level), formula };
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

describe('FindComposites', () => {
  const org = { org: 'octo-org' };
  const repo = { org: 'octo-org', repo: 'widgets' };

  it('returns every variable that has a formula', () => {
    const items = [
      MakeCompositeVariable('CDN', '$(BASE_URL)/cdn', repo, 'repository'),
      MakeVariable('BASE_URL', 'https://example.com', org, 'organization'),
      MakeCompositeVariable('API_BASE', '$(BASE_URL)/api', repo, 'repository'),
    ];

    expect(FindComposites(items).map((i) => i.name)).toEqual(['CDN', 'API_BASE']);
  });

  it('excludes secrets even if they somehow carried a formula field', () => {
    const secret = { ...MakeVariable('TOKEN', '', repo, 'repository'), kind: 'secret' as const, formula: '$(X)' };

    expect(FindComposites([secret])).toEqual([]);
  });

  it('returns an empty array when there are no composite variables', () => {
    const items = [MakeVariable('PLAIN', 'just-a-value', org, 'organization')];

    expect(FindComposites(items)).toEqual([]);
  });

  it('returns an empty array for an empty item list', () => {
    expect(FindComposites([])).toEqual([]);
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
      MakeCompositeVariable('CDN', '$(BASE_URL)/cdn', repo, 'repository'),
    ];

    const dependents = FindDependents(items, 'BASE_URL', org);

    expect(dependents.map((i) => i.name)).toEqual(['CDN']);
  });

  it('finds an environment-level composite referencing a repository-level target', () => {
    const items = [MakeCompositeVariable('CDN', '$(BASE_URL)/cdn', prodEnv, 'environment')];

    const dependents = FindDependents(items, 'BASE_URL', repo);

    expect(dependents.map((i) => i.name)).toEqual(['CDN']);
  });

  it('excludes an environment-level composite that is a different environment than the target', () => {
    const items = [MakeCompositeVariable('CDN', '$(BASE_URL)/cdn', stagingEnv, 'environment')];

    const dependents = FindDependents(items, 'BASE_URL', prodEnv);

    expect(dependents).toEqual([]);
  });

  it('excludes a same-named composite from an unrelated repo (no cross-repo reference possible)', () => {
    const items = [MakeCompositeVariable('CDN', '$(BASE_URL)/cdn', otherRepo, 'repository')];

    const dependents = FindDependents(items, 'BASE_URL', repo);

    expect(dependents).toEqual([]);
  });

  it('excludes a repository-level composite from seeing an environment-level target (wrong direction in the precedence chain)', () => {
    const items = [MakeCompositeVariable('CDN', '$(ENV_ONLY)/cdn', repo, 'repository')];

    const dependents = FindDependents(items, 'ENV_ONLY', prodEnv);

    expect(dependents).toEqual([]);
  });

  it('ignores a non-composite variable even if its value happens to contain the target name', () => {
    const items = [MakeVariable('PLAIN', 'BASE_URL', org, 'organization')];

    const dependents = FindDependents(items, 'BASE_URL', org);

    expect(dependents).toEqual([]);
  });

  it('ignores an old-model variable whose value still literally contains "$(...)" text but has no formula (no manifest entry)', () => {
    const items = [MakeVariable('CDN', '$(BASE_URL)/cdn', repo, 'repository')];

    const dependents = FindDependents(items, 'BASE_URL', repo);

    expect(dependents).toEqual([]);
  });

  it('excludes the target item itself', () => {
    const items = [MakeCompositeVariable('SELF', '$(SELF)', org, 'organization')];

    const dependents = FindDependents(items, 'SELF', org);

    expect(dependents).toEqual([]);
  });
});

describe('FindComposableCandidates', () => {
  const org = { org: 'octo-org' };
  const repo = { org: 'octo-org', repo: 'widgets' };
  const prodEnv = { org: 'octo-org', repo: 'widgets', env: 'prod' };
  const otherRepo = { org: 'octo-org', repo: 'other' };

  it('includes variables reachable per the env > repo > org precedence chain', () => {
    const items = [
      MakeVariable('BASE_URL', 'https://example.com', org, 'organization'),
      MakeVariable('API_KEY', 'abc123', repo, 'repository'),
      MakeVariable('OTHER_REPO_ONLY', 'x', otherRepo, 'repository'),
    ];

    const candidates = FindComposableCandidates(items, prodEnv);

    expect(candidates.map((i) => i.name)).toEqual(['BASE_URL', 'API_KEY']);
  });

  it('excludes the item currently being edited via excludeId', () => {
    const self = MakeVariable('SELF', 'x', repo, 'repository');
    const other = MakeVariable('OTHER', 'y', repo, 'repository');

    const candidates = FindComposableCandidates([self, other], repo, self.id);

    expect(candidates.map((i) => i.name)).toEqual(['OTHER']);
  });

  it('excludes secrets — composites can never reference a secret', () => {
    const secret: LedgerItem = { ...MakeVariable('TOKEN', '', repo, 'repository'), kind: 'secret' };

    const candidates = FindComposableCandidates([secret], repo);

    expect(candidates).toEqual([]);
  });

  it('excludes a variable outside the target scope chain', () => {
    const items = [MakeVariable('ENV_ONLY', 'x', prodEnv, 'environment')];

    const candidates = FindComposableCandidates(items, repo);

    expect(candidates).toEqual([]);
  });
});

describe('DetectComposeTrigger', () => {
  it('detects the caret inside an open, empty $(', () => {
    expect(DetectComposeTrigger('$(', 2)).toEqual({ start: 2, partial: '' });
  });

  it('detects the caret inside an open $( with a partial name typed', () => {
    expect(DetectComposeTrigger('$(BASE_', 7)).toEqual({ start: 2, partial: 'BASE_' });
  });

  it('returns null once the reference has been closed', () => {
    expect(DetectComposeTrigger('$(BASE_URL)', 11)).toBeNull();
  });

  it('returns null when there is no "$(" at all', () => {
    expect(DetectComposeTrigger('just-a-value', 5)).toBeNull();
  });

  it('detects the caret mid-formula after other text precedes the "$("', () => {
    expect(DetectComposeTrigger('prefix-$(BASE', 13)).toEqual({ start: 9, partial: 'BASE' });
  });

  it('picks the nearest unclosed "$(" among multiple references on one line', () => {
    expect(DetectComposeTrigger('$(BASE_URL)/$(SUF', 17)).toEqual({ start: 14, partial: 'SUF' });
  });

  it('returns null when the caret sits after a closed reference with no new "$(" opened yet', () => {
    expect(DetectComposeTrigger('$(BASE_URL)/cdn', 15)).toBeNull();
  });
});
