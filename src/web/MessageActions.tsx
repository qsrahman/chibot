import { useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, X } from 'lucide-react'
import type { Versions } from './turns.ts'

const FEEDBACK_MS = 2000

/** A small muted icon button for message and code-block actions. */
export function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="action"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** Copies `text`, then briefly shows whether it worked. */
export function CopyButton({
  text,
  label = 'Copy',
}: {
  text: string
  label?: string
}) {
  const [result, setResult] = useState<'copied' | 'failed' | null>(null)

  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => setResult(null), FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [result])

  return (
    <IconAction
      label={
        result === 'copied'
          ? 'Copied'
          : result === 'failed'
            ? 'Copy failed'
            : label
      }
      // The Clipboard API needs a secure context (localhost counts; plain
      // http on a LAN address doesn't), so failure is possible.
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => setResult('copied'),
          () => setResult('failed'),
        )
      }
    >
      {result === 'copied' ? <Check /> : result === 'failed' ? <X /> : <Copy />}
    </IconAction>
  )
}

/** `< 2/3 >`: steps through the versions of a message or answer. */
export function VersionSwitcher({
  versions: { index, ids },
  disabled,
  onSwitch,
}: {
  versions: Versions
  disabled?: boolean
  onSwitch: (itemId: number) => void
}) {
  return (
    <span className="versions">
      <IconAction
        label="Previous version"
        disabled={disabled || index === 1}
        onClick={() => onSwitch(ids[index - 2]!)}
      >
        <ChevronLeft />
      </IconAction>
      <span className="versions-count">
        {index}/{ids.length}
      </span>
      <IconAction
        label="Next version"
        disabled={disabled || index === ids.length}
        onClick={() => onSwitch(ids[index]!)}
      >
        <ChevronRight />
      </IconAction>
    </span>
  )
}
