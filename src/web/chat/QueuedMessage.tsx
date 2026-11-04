import { Clock, Pencil, X } from 'lucide-react'

/** The message waiting for the current answer, with edit and cancel. */
export function QueuedMessage({
  text,
  onEdit,
  onCancel,
}: {
  text: string
  onEdit: () => void
  onCancel: () => void
}) {
  return (
    <div className="composer-queued">
      <Clock size={15} strokeWidth={1.75} aria-hidden />
      <span className="composer-queued-label">Queued</span>
      <span className="composer-queued-text" title={text}>
        {text}
      </span>
      <button
        type="button"
        className="composer-queued-action"
        aria-label="Edit queued message"
        title="Edit queued message"
        onClick={onEdit}
      >
        <Pencil size={14} aria-hidden />
      </button>
      <button
        type="button"
        className="composer-queued-action"
        aria-label="Cancel queued message"
        title="Cancel queued message"
        onClick={onCancel}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  )
}
