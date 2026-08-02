import type { ItemLevel } from '../../api/types'

const levelLabel: Record<ItemLevel, string> = {
  organization: 'Organization',
  repository: 'Repository',
  environment: 'Environment',
}

interface SectionHeaderProps {
  level: ItemLevel
  scopeLabel: string
  description: string
  onAdd: () => void
}

export function SectionHeader({ level, scopeLabel, description, onAdd }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-l-2 border-line py-2 pl-3">
      <div className="min-w-0">
        <p className="truncate font-sans text-sm font-semibold text-text">
          {levelLabel[level]} <span className="font-normal text-text-dim">&middot; {scopeLabel}</span>
        </p>
        <p className="truncate text-xs text-text-dim">{description}</p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="shrink-0 rounded-md border border-line px-2.5 py-1 font-sans text-xs font-medium text-text-dim hover:border-variable hover:text-variable"
      >
        + Add
      </button>
    </div>
  )
}
