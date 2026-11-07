import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'

export interface ToastOptions {
  /** One button, e.g. Undo. */
  action?: { label: string; onClick: () => void }
  /** How long it stays, in ms; hovering or focusing it keeps it. */
  duration?: number
  /** The icon: a confirmation (the default), a failure or a plain note. */
  kind?: 'success' | 'error' | 'info'
}

interface Toasts {
  /** A message at the bottom of the window. */
  toast: (message: string, options?: ToastOptions) => void
  /** Said to screen readers only (e.g. "Copied", where the icon already changed). */
  announce: (message: string) => void
}

const noop: Toasts = { toast: () => {}, announce: () => {} }
const ToastContext = createContext<Toasts>(noop)

export const useToast = () => useContext(ToastContext)

interface Item extends ToastOptions {
  id: number
  message: string
}

const MAX_SHOWN = 3

/**
 * Brief feedback that doesn't interrupt: a stack of toasts and one polite
 * live region. It sits last in the page, so Tab reaches an action (Undo) after
 * everything else; the live region exists from the start so announcements work.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const [spoken, setSpoken] = useState('')
  const nextId = useRef(0)
  const layer = useRef<HTMLDivElement>(null)

  // Open while there is a toast. A new one re-opens it, so it lands above a
  // dialog that opened since (the top layer stacks by when each was shown).
  const newest = items.at(-1)?.id
  useEffect(() => {
    const el = layer.current
    if (!el) return
    const open = el.matches(':popover-open')
    if (newest === undefined) {
      if (open) el.hidePopover()
      return
    }
    if (open) el.hidePopover()
    el.showPopover()
  }, [newest])

  const dismiss = useCallback(
    (id: number) => setItems((all) => all.filter((item) => item.id !== id)),
    [],
  )
  const api = useMemo<Toasts>(
    () => ({
      toast: (message, options) => {
        const id = nextId.current++
        setItems((all) =>
          [...all, { id, message, ...options }].slice(-MAX_SHOWN),
        )
        setSpoken(message)
      },
      // Said twice in a row must still be announced: change the text.
      announce: (message) =>
        setSpoken((was) => (was === message ? `${message} ` : message)),
    }),
    [],
  )

  return (
    <ToastContext value={api}>
      {children}
      {/* A popover, so it is in the top layer: a toast raised inside a modal
          dialog (Settings) would otherwise sit behind the dialog's backdrop. */}
      <div className="toasts" popover="manual" ref={layer}>
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
      <p className="visually-hidden toast-live" aria-live="polite">
        {spoken}
      </p>
    </ToastContext>
  )
}

function ToastView({
  item,
  onDismiss,
}: {
  item: Item
  onDismiss: (id: number) => void
}) {
  const [held, setHeld] = useState(false)
  const { id, duration = 6000, kind = 'success' } = item
  useEffect(() => {
    if (held) return
    const timer = setTimeout(() => onDismiss(id), duration)
    return () => clearTimeout(timer)
  }, [held, id, duration, onDismiss])

  return (
    <div
      className="toast"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      {kind === 'error' ? (
        <CircleAlert size={18} strokeWidth={1.5} aria-hidden />
      ) : kind === 'info' ? (
        <Info size={18} strokeWidth={1.5} aria-hidden />
      ) : (
        <CircleCheck size={18} strokeWidth={1.5} aria-hidden />
      )}
      <span className="toast-message">{item.message}</span>
      {item.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            item.action!.onClick()
            onDismiss(id)
          }}
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        className="icon-button toast-close"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => onDismiss(id)}
      >
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  )
}
