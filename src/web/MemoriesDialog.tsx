import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { MAX_MEMORIES, MAX_MEMORY_LENGTH } from '../shared/memory.ts'
import { deleteMemories, listMemories, updateMemory } from './api.ts'
import { ConfirmDialog, Dialog } from './Dialog.tsx'
import { useLoad } from './useLoad.ts'

interface Props {
  open: boolean
  onClose: () => void
}

/** What chibot remembers, newest first, to edit or delete. */
export function MemoriesDialog({ open, onClose }: Props) {
  const [confirmAll, setConfirmAll] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [text, setText] = useState('')
  const { data: memories = [], error, act } = useLoad(listMemories, open)

  const save = async (id: number) => {
    if (await act(() => updateMemory(id, text))) setEditing(null)
  }

  return (
    <Dialog open={open} onClose={onClose} title="Memories" className="archived">
      <p className="dialog-body">
        What chibot remembers about you across chats. Edit or delete a memory
        here.
      </p>
      {error && <p className="sidebar-note">{error}</p>}
      {memories.length > 0 && (
        <p className="memory-count">
          {memories.length} of {MAX_MEMORIES} memories
        </p>
      )}
      {memories.length === 0 && !error && (
        <p className="dialog-body">chibot doesn’t remember anything yet.</p>
      )}
      <ul className="archived-list">
        {memories.map((memory) => (
          <li key={memory.id} className="archived-row">
            {editing === memory.id ? (
              <form
                className="memory-edit"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (text.trim()) void save(memory.id)
                }}
              >
                <input
                  className="memory-edit-input"
                  aria-label="Memory"
                  value={text}
                  maxLength={MAX_MEMORY_LENGTH}
                  autoFocus
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
                <button
                  type="submit"
                  className="button primary"
                  disabled={!text.trim()}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="memory-text">{memory.text}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Edit memory: ${memory.text}`}
                  title="Edit"
                  onClick={() => {
                    setEditing(memory.id)
                    setText(memory.text)
                  }}
                >
                  <Pencil size={18} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`Delete memory: ${memory.text}`}
                  title="Delete"
                  onClick={() => void act(() => deleteMemories(memory.id))}
                >
                  <Trash2 size={18} strokeWidth={1.5} />
                </button>
              </>
            )}
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
