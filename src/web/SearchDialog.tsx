import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { MessageSquare } from 'lucide-react'
import type { ConversationListItem } from '../shared/types.ts'
import { searchConversations } from './api.ts'
import { Dialog } from './Dialog.tsx'
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
        placeholder="Search chats…"
        aria-label="Search chats"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && shown[0]) openChat(shown[0].id)
        }}
      />
      <div className="search-results">
        {!results && shown.length > 0 && (
          <h3 className="sidebar-heading">Recent</h3>
        )}
        {error && <p className="sidebar-note">{error}</p>}
        {results?.length === 0 && (
          <p className="sidebar-note">No chats match “{query.trim()}”.</p>
        )}
        {shown.map((item) => (
          <button
            key={item.id}
            type="button"
            className="search-result"
            onClick={() => openChat(item.id)}
          >
            <span className="row-icon" aria-hidden>
              <MessageSquare />
            </span>
            <span className="search-text">
              <span className="search-title">{item.title ?? UNTITLED}</span>
              {item.snippet && (
                <span className="search-snippet">{item.snippet}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}
