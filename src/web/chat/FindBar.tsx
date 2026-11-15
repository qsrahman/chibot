import { useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import {
  expandCodeBlock,
  findRanges,
  jumpTo,
  matchLabel,
  stepMatch,
} from './find.ts'

/**
 * Find in this chat: highlights matches in the messages and answers on screen
 * (the CSS Custom Highlight API, so React's DOM is left alone) and steps
 * through them. `content` changes whenever the messages do, which refreshes
 * the matches without moving the view. The browser's own Ctrl/Cmd+F is left alone.
 */
export function FindBar({
  root,
  content,
  onJump,
  onClose,
}: {
  root: RefObject<HTMLElement | null>
  content: unknown[]
  /** Called before the view moves to a match (so it stops following the newest message). */
  onJump: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const [found, setFound] = useState<Range[]>([])
  // Set when the user chose a match (typed, or stepped), and so the view should go to it.
  const reveals = useRef(false)

  useEffect(() => {
    const ranges = root.current ? findRanges(root.current, query) : []
    setFound(ranges)
    // Nothing to go to: don't keep the request for matches that appear later.
    if (ranges.length === 0) reveals.current = false
    const typed = reveals.current
    setCurrent((was) =>
      typed ? 0 : Math.max(0, Math.min(was, ranges.length - 1)),
    )
  }, [root, query, ...content])

  useEffect(() => {
    if (!CSS.highlights) return
    CSS.highlights.set('find', new Highlight(...found))
    const range = found[current]
    if (range) CSS.highlights.set('find-current', new Highlight(range))
    else CSS.highlights.delete('find-current')
    // Stays set through the render before the new matches arrive (found is empty then).
    if (range && reveals.current) {
      onJump()
      expandCodeBlock(range.startContainer.parentElement)
      jumpTo(range.startContainer.parentElement, 'center')
      reveals.current = false
    }
  }, [found, current])

  useEffect(
    () => () => {
      CSS.highlights?.delete('find')
      CSS.highlights?.delete('find-current')
    },
    [],
  )

  const step = (back: boolean) => {
    reveals.current = true
    setCurrent(stepMatch(current, found.length, back))
  }

  return (
    <search className="find-bar">
      <input
        type="search"
        className="find-input"
        aria-label="Find in chat"
        placeholder="Find in chat"
        autoFocus
        dir="auto"
        value={query}
        onChange={(e) => {
          reveals.current = true
          setQuery(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Not also "stop the answer".
            e.stopPropagation()
            onClose()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey)
          }
        }}
      />
      <span className="find-count" role="status">
        {matchLabel(query, current, found.length)}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label="Previous match"
        title="Previous match"
        disabled={found.length === 0}
        onClick={() => step(true)}
      >
        <ChevronUp size={20} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Next match"
        title="Next match"
        disabled={found.length === 0}
        onClick={() => step(false)}
      >
        <ChevronDown size={20} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Close find"
        title="Close find"
        onClick={onClose}
      >
        <X size={20} strokeWidth={1.5} />
      </button>
    </search>
  )
}
