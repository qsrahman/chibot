import { useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { MessageSquare } from 'lucide-react'
import type { ConversationListItem } from '../../shared/types.ts'
import { searchConversations } from './api.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { UNTITLED } from './useConversations.ts'

interface Props {
  open: boolean
  onClose: () => void
  /** Shown before anything is typed. */
  recent: ConversationListItem[]
}

const DEBOUNCE_MS = 150

export function SearchDialog({ open, onClose, recent }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ConversationListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The result Enter opens (marked, and named by the field for screen readers).
  const [active, setActive] = useState(0)
  const listId = useId()

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchConversations(q, controller.signal).then(
        (found) => {
          setResults(found)
          setError(null)
        },
        (err: Error) => {
          if (err.name !== 'AbortError') setError(err.message)
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const shown = results ?? recent.slice(0, 8)
  const optionId = (index: number) => `${listId}-${index}`
  // A new list starts at its first result.
  useEffect(() => setActive(0), [results, open])
  // Keep the marked one in view when the list scrolls.
  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({
      block: 'nearest',
    })
  }, [active])
  // Read out when results arrive (the list itself changes under the field).
  const announcement =
    results === null
      ? ''
      : results.length === 0
        ? `No chats match “${query.trim()}”.`
        : `${results.length} ${results.length === 1 ? 'chat' : 'chats'} found`

  function openChat(id: string) {
    onClose()
    navigate(`/c/${id}`)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Search chats"
      className="search"
    >
      <input
        className="search-input"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-activedescendant={shown.length > 0 ? optionId(active) : undefined}
        placeholder="Search chats…"
        aria-label="Search chats"
        dir="auto"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (shown.length === 0) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            // Round the ends; the caret stays where it is.
            e.preventDefault()
            const step = e.key === 'ArrowDown' ? 1 : -1
            setActive((i) => (i + step + shown.length) % shown.length)
          } else if (e.key === 'Enter' && shown[active]) {
            openChat(shown[active].id)
          }
        }}
      />
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      <div className="search-results">
        {!results && shown.length > 0 && (
          <h3 className="sidebar-heading">Recent</h3>
        )}
        {error && <p className="sidebar-note">{error}</p>}
        {results?.length === 0 && (
          <p className="sidebar-note">No chats match “{query.trim()}”.</p>
        )}
        <div
          id={listId}
          role="listbox"
          aria-label={results ? 'Matching chats' : 'Recent chats'}
        >
          {shown.map((item, index) => (
            <button
              key={item.id}
              id={optionId(index)}
              type="button"
              role="option"
              aria-selected={index === active}
              // Reached by the arrow keys from the field, not by Tab.
              tabIndex={-1}
              className="search-result"
              onClick={() => openChat(item.id)}
              onMouseMove={() => setActive(index)}
            >
              <span className="row-icon" aria-hidden>
                <MessageSquare />
              </span>
              <span className="search-text">
                <span className="search-title" dir="auto">
                  {item.title ?? UNTITLED}
                </span>
                {item.snippet && (
                  <span className="search-snippet" dir="auto">
                    {item.snippet}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
