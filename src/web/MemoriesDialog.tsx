import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { deleteMemories, listMemories } from './api.ts'
import { ConfirmDialog, Dialog } from './Dialog.tsx'
import { useLoad } from './useLoad.ts'

interface Props {
  open: boolean
  onClose: () => void
}

/** What chibot remembers, newest first, to delete one or all. */
export function MemoriesDialog({ open, onClose }: Props) {
  const [confirmAll, setConfirmAll] = useState(false)
  const { data: memories = [], error, act } = useLoad(listMemories, open)

  return (
    <Dialog open={open} onClose={onClose} title="Memories" className="archived">
      <p className="dialog-body">
        What chibot remembers about you across chats. To change one, tell chibot
        in a chat.
      </p>
      {error && <p className="sidebar-note">{error}</p>}
      {memories.length === 0 && !error && (
        <p className="dialog-body">chibot doesn’t remember anything yet.</p>
      )}
      <ul className="archived-list">
        {memories.map((memory) => (
          <li key={memory.id} className="archived-row">
            <span className="memory-text">{memory.text}</span>
            <button
              type="button"
              className="icon-button danger"
              aria-label={`Delete memory: ${memory.text}`}
              title="Delete"
              onClick={() => void act(() => deleteMemories(memory.id))}
            >
              <Trash2 size={18} strokeWidth={1.5} />
            </button>
          </li>
        ))}
      </ul>
      {memories.length > 0 && (
        <div className="dialog-actions">
          <button
            type="button"
            className="button danger"
            onClick={() => setConfirmAll(true)}
          >
            Delete all
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirmAll}
        title="Delete all memories?"
        message="chibot will forget everything it remembers about you. This can't be undone."
        confirmLabel="Delete all"
        onConfirm={() => void act(() => deleteMemories())}
        onClose={() => setConfirmAll(false)}
      />
    </Dialog>
  )
}
