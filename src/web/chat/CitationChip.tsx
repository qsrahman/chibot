import { useEffect, useState } from 'react'
import { ArrowUpRight, FileText, Globe, MessageSquare } from 'lucide-react'
import { Link } from 'react-router'
import { useAnchoredPopover } from '../ui/popover.ts'
import { sourceHost, type Source } from './turns.ts'

const KIND_ICON = { chat: MessageSquare, file: FileText }
const OPEN = { chat: 'Open chat', file: 'Open file' }

/**
 * A numbered chip after a claim, tied to one of the answer's sources. Hovering
 * or focusing it (or tapping it) opens a card with where the source is from,
 * its title and snippet, and a link to open it. The card is a native popover;
 * Esc, a click elsewhere or leaving closes it. Titles and snippets are other
 * people's text, so they are shown as text only.
 */
export function CitationChip({
  source,
  number,
  total,
}: {
  source: Source
  number: number
  total: number
}) {
  const popover = useAnchoredPopover()
  const [open, setOpen] = useState(false)
  const show = () => {
    const card = popover.ref.current
    if (card && !card.matches(':popover-open')) card.showPopover()
  }
  // Esc hides the card without also stopping the answer.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      popover.hide()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, popover])
  const Icon = (source.kind && KIND_ICON[source.kind]) || Globe
  const label = source.kind ? OPEN[source.kind] : 'Open page'
  const opener = (
    <>
      {label}
      <ArrowUpRight size={14} aria-hidden />
    </>
  )
  return (
    // The card is inside this span, so moving the pointer onto it isn't leaving.
    <span
      className="cite-chip-wrap"
      // A tap is a click; only a mouse hovers.
      onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
      onPointerLeave={popover.hide}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) popover.hide()
      }}
    >
      <button
        type="button"
        className="cite-chip"
        aria-label={`Source ${number}: ${source.title}`}
        aria-expanded={open}
        aria-controls={popover.id}
        style={popover.triggerStyle}
        onFocus={show}
        onClick={show}
      >
        {number}
      </button>
      <div
        id={popover.id}
        ref={popover.ref}
        popover="auto"
        className="cite-pop"
        style={popover.style}
        onToggle={(e) => setOpen(e.newState === 'open')}
      >
        <div className="cite-source">
          <div className="cite-source-head">
            <Icon size={16} aria-hidden />
            <span>{sourceHost(source)}</span>
            <span className="cite-source-count">
              {number} of {total}
            </span>
          </div>
          <div className="cite-source-title" dir="auto">
            {source.title}
          </div>
          {source.snippet && (
            <div className="cite-source-snippet" dir="auto">
              {source.snippet}
            </div>
          )}
          {source.kind === 'chat' ? (
            <Link to={source.url} className="cite-source-open">
              {opener}
            </Link>
          ) : (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="cite-source-open"
            >
              {opener}
            </a>
          )}
        </div>
      </div>
    </span>
  )
}
