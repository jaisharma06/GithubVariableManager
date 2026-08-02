import type { LedgerItem } from '../../api/types'

export const ROW_GRID = 'grid grid-cols-[3px_3rem_1fr_1fr_5rem_4.5rem] items-center'

interface LedgerRowProps {
  item: LedgerItem
  hideValues: boolean
  onEdit: () => void
  onDelete: () => void
}

export function LedgerRow({ item, hideValues, onEdit, onDelete }: LedgerRowProps) {
  const isSecret = item.kind === 'secret'
  const masked = isSecret || hideValues
  const railColor = isSecret ? 'bg-secret' : 'bg-variable'

  return (
    <div className={`group ${ROW_GRID} border-b border-line last:border-b-0 hover:bg-panel-raised`}>
      <span className={`h-full min-h-[2.75rem] ${railColor}`} aria-hidden="true" />

      <span
        className={`px-3 py-2.5 font-mono text-[10px] font-semibold tracking-wide ${
          isSecret ? 'text-secret' : 'text-variable'
        }`}
      >
        {isSecret ? 'SEC' : 'VAR'}
      </span>

      <span className="truncate px-1 py-2.5 font-mono text-sm text-text">{item.name}</span>

      <span className="truncate px-3 py-2.5 font-mono text-sm">
        {isSecret ? (
          <span className="text-secret/70">•••••••• write-only</span>
        ) : masked ? (
          <span className="tracking-widest text-text-dim">••••••••••••</span>
        ) : (
          <span className="text-text">{item.value}</span>
        )}
      </span>

      <span className="truncate px-3 py-2.5 text-xs text-text-dim">
        {item.kind === 'secret' && item.visibility ? item.visibility : ''}
      </span>

      <span className="flex items-center gap-1 px-3 py-2.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {isSecret ? (
          <span title="Secrets are write-only — GitHub never returns their value." className="px-1 text-text-dim">
            <LockIcon />
          </span>
        ) : null}
        <button type="button" onClick={onEdit} title="Edit" className="rounded p-1.5 text-text-dim hover:text-text">
          <EditIcon />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete"
          className="rounded p-1.5 text-text-dim hover:text-danger"
        >
          <TrashIcon />
        </button>
      </span>
    </div>
  )
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
    </svg>
  )
}
