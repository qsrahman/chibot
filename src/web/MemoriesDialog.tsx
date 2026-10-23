import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Memory } from '../shared/types.ts'
import { deleteMemories, listMemories } from './api.ts'
import { ConfirmDialog, Dialog } from './Dialog.tsx'

interface Props {
  open: boolean
  onClose: () => void
}

/** What chibot remembers, newest first, to delete one or all. */
export function MemoriesDialog({ open, onClose }: Props) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)

  const load = useCallback(async () => {
    try {
      setMemories(await listMemories())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function act(action: () => Promise<unknown>) {
    try {
      await action()
    } catch (err) {
      return setError((err as Error).message)
    }
    await load()
  }

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
