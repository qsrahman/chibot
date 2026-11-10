// A summary in the chat: the line where earlier messages end, opening to the
// summary, and the form that asks for another.
import { useState } from 'react'
import { ListCollapse, Undo2 } from 'lucide-react'
import { IconButton } from '../ui/IconButton.tsx'
import { IconAction } from './MessageActions.tsx'
import { Markdown } from './Markdown.tsx'
import { Summary } from '../ui/Summary.tsx'
import type { Compaction } from '../../shared/types.ts'

const number = new Intl.NumberFormat(undefined, { notation: 'compact' })

/** Where earlier messages were summarized; opens to the summary. */
export function CompactionNote({
  compaction,
  busy,
  onUndo,
}: {
  compaction: Compaction
  busy: boolean
  onUndo: () => void
}) {
  return (
    <details className="compaction-note">
      <Summary>Earlier messages were summarized to save context</Summary>
      <div className="compaction-body">
        <Markdown text={compaction.summary} />
        <p className="compaction-meta">
          Written by {compaction.summaryModel}, about{' '}
          {number.format(compaction.tokensBefore)} →{' '}
          {number.format(compaction.tokensAfter)} tokens.
          {compaction.degraded &&
            ' It may have left out a name or link you wrote.'}
        </p>
        <IconButton label="Undo" disabled={busy} onClick={onUndo}>
          <Undo2 size={18} strokeWidth={1.5} />
        </IconButton>
      </div>
    </details>
  )
}

/** Summarizes the start of the chat now, optionally keeping one thing in mind. */
export function CompactNow({
  busy,
  onCompact,
}: {
  busy: boolean
  onCompact: (focus: string) => void
}) {
  const [focus, setFocus] = useState('')
  const [open, setOpen] = useState(false)
  return (
    <div className="compact-now">
      <IconAction
        label="Compact now"
        pressed={open}
        onClick={() => setOpen(!open)}
      >
        <ListCollapse />
      </IconAction>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onCompact(focus.trim())
            setFocus('')
            setOpen(false)
          }}
        >
          <input
            type="text"
            value={focus}
            maxLength={800}
            placeholder="What to keep in mind (optional)"
            aria-label="What the summary should keep in mind"
            onChange={(e) => setFocus(e.target.value)}
          />
          <IconButton label="Summarize" type="submit" disabled={busy}>
            <ListCollapse size={18} strokeWidth={1.5} />
          </IconButton>
        </form>
      )}
    </div>
  )
}
