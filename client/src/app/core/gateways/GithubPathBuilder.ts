// Direct port of web/src/api/paths.ts.
import type { ItemLevel, ScopeRef } from '../Types';

export function VariablesPath(scope: ScopeRef, level: ItemLevel): string {
  if (level === 'organization') return `/orgs/${scope.org}/actions/variables`;
  if (level === 'repository') return `/repos/${scope.org}/${scope.repo}/actions/variables`;
  return `/repos/${scope.org}/${scope.repo}/environments/${encodeURIComponent(scope.env!)}/variables`;
}

export function SecretsPath(scope: ScopeRef, level: ItemLevel): string {
  if (level === 'organization') return `/orgs/${scope.org}/actions/secrets`;
  if (level === 'repository') return `/repos/${scope.org}/${scope.repo}/actions/secrets`;
  return `/repos/${scope.org}/${scope.repo}/environments/${encodeURIComponent(scope.env!)}/secrets`;
}

export function ItemId(kind: 'variable' | 'secret', level: ItemLevel, scope: ScopeRef, name: string): string {
  return [kind, level, scope.org, scope.repo ?? '', scope.env ?? '', name].join(':');
}
