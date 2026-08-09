import type { ItemLevel, ScopeRef } from '../Types';

export function ItemId(kind: 'variable' | 'secret', level: ItemLevel, scope: ScopeRef, name: string): string {
  return [kind, level, scope.org, scope.repo ?? '', scope.env ?? '', name].join(':');
}
