import { useEffect, useId, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  className?: string
  children: ReactNode
}

/**
 * A native modal `<dialog>` driven by the `open` prop. Esc and a click on
 * the backdrop both close it.
 */
export function Dialog({ open, onClose, title, className, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current!
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    // Safari lacks `closedby="any"`: close on clicks outside the dialog box.
    if ('closedBy' in HTMLDialogElement.prototype) return
    const dialog = ref.current!
    const onClick = (event: MouseEvent) => {
      if (event.target !== dialog) return
      const r = dialog.getBoundingClientRect()
      const inside =
        r.top <= event.clientY &&
        event.clientY <= r.bottom &&
        r.left <= event.clientX &&
        event.clientX <= r.right
      if (!inside) dialog.close()
    }
    dialog.addEventListener('click', onClick)
    return () => dialog.removeEventListener('click', onClick)
  }, [])

  return (
    <dialog
      ref={ref}
      closedby="any"
      aria-labelledby={titleId}
      className={className ? `dialog ${className}` : 'dialog'}
      onClose={onClose}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      {children}
    </dialog>
  )
}

interface ConfirmProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

/** A yes/no dialog for destructive actions. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="dialog-body">{message}</p>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button danger"
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
