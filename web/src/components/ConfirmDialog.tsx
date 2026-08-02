import { useEffect, useRef } from 'react'
import { Button } from './Button'

interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  error?: string | null
  confirming?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  error,
  confirming,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 px-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-lg border border-line bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="font-sans text-base font-semibold text-text">
          {title}
        </h2>
        <p className="mt-2 text-sm text-text-dim">{description}</p>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={confirming}>
            Cancel
          </Button>
          <Button ref={confirmRef} variant="danger" onClick={onConfirm} disabled={confirming}>
            {confirming ? 'Deleting…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
