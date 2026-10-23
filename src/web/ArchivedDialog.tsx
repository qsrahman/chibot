import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import type { ConversationListItem } from '../shared/types.ts'
import {
  deleteConversation,
  listConversations,
  updateConversation,
} from './api.ts'
import { DeleteChatDialog, Dialog } from './Dialog.tsx'
import { UNTITLED } from './useConversations.ts'
import { useLoad } from './useLoad.ts'

interface Props {
  open: boolean
  onClose: () => void
  /** Called after a restore, so the sidebar list can refresh. */
  onChanged: () => void
  onDeleted: (id: string) => void
}

export function ArchivedDialog({ open, onClose, onChanged, onDeleted }: Props) {
  const navigate = useNavigate()
  const [toDelete, setToDelete] = useState<ConversationListItem | null>(null)
  const {
    data: archived = [],
    error,
    act,
  } = useLoad(
    useCallback(() => listConversations({ archived: true }), []),
    open,
  )

  async function restore(id: string) {
    if (await act(() => updateConversation(id, { archived: false }))) {
      onChanged()
    }
  }

  async function remove(id: string) {
    if (await act(() => deleteConversation(id))) onDeleted(id)
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
      <DeleteChatDialog
        chat={toDelete}
        onDelete={(id) => void remove(id)}
        onClose={() => setToDelete(null)}
      />
    </Dialog>
  )
}
