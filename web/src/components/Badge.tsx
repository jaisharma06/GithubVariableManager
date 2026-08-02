import type { ItemKind } from '../api/types'

const kindStyles: Record<ItemKind, string> = {
  variable: 'bg-variable-dim text-variable',
  secret: 'bg-secret-dim text-secret',
}

const kindLabel: Record<ItemKind, string> = {
  variable: 'VAR',
  secret: 'SEC',
}

export function KindBadge({ kind }: { kind: ItemKind }) {
  return (
    <span
      className={`inline-flex w-10 shrink-0 items-center justify-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide ${kindStyles[kind]}`}
    >
      {kindLabel[kind]}
    </span>
  )
}
