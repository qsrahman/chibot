import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import type { ConversationListItem } from '../shared/types.ts'
import {
  deleteConversation,
  listConversations,
  updateConversation,
} from './api.ts'
import { ConfirmDialog, Dialog } from './Dialog.tsx'
import { UNTITLED } from './useConversations.ts'

interface Props {
  open: boolean
  onClose: () => void
  /** Called after a restore, so the sidebar list can refresh. */
  onChanged: () => void
  onDeleted: (id: string) => void
}

export function ArchivedDialog({ open, onClose, onChanged, onDeleted }: Props) {
  const navigate = useNavigate()
  const [archived, setArchived] = useState<ConversationListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<ConversationListItem | null>(null)

  const load = useCallback(async () => {
    try {
      setArchived(await listConversations({ archived: true }))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function restore(id: string) {
    await updateConversation(id, { archived: false })
    await load()
    onChanged()
  }

  async function remove(id: string) {
    await deleteConversation(id)
    await load()
    onDeleted(id)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Archived chats"
      className="archived"
    >
      {error && <p className="sidebar-note">{error}</p>}
      {archived.length === 0 && !error && (
        <p className="dialog-body">You have no archived chats.</p>
      )}
      <ul className="archived-list">
        {archived.map((item) => (
          <li key={item.id} className="archived-row">
            <button
              type="button"
              className="archived-title"
              onClick={() => {
                onClose()
                navigate(`/c/${item.id}`)
              }}
            >
              {item.title ?? UNTITLED}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Restore ${item.title ?? UNTITLED}`}
              title="Restore"
              onClick={() => void restore(item.id)}
            >
              <ArchiveRestore size={18} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="icon-button danger"
              aria-label={`Delete ${item.title ?? UNTITLED}`}
              title="Delete"
              onClick={() => setToDelete(item)}
            >
              <Trash2 size={18} strokeWidth={1.5} />
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={toDelete !== null}
        title="Delete chat?"
        message={
          <>
            This will delete <strong>{toDelete?.title ?? UNTITLED}</strong> and
            all its messages. This can't be undone.
          </>
        }
        confirmLabel="Delete"
        onConfirm={() => toDelete && void remove(toDelete.id)}
        onClose={() => setToDelete(null)}
      />
    </Dialog>
  )
}
