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
import { X } from 'lucide-react'

export interface ToastOptions {
  /** One button, e.g. Undo. */
  action?: { label: string; onClick: () => void }
  /** How long it stays, in ms; hovering or focusing it keeps it. */
  duration?: number
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
      <div className="toasts">
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
  const { id, duration = 6000 } = item
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
