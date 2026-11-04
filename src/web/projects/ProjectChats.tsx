import { useState } from 'react'
import type {
  ConversationListItem,
  ConversationPatch,
} from '../../shared/types.ts'
import { ConversationRow } from '../conversations/ConversationRow.tsx'
import { DeleteChatDialog } from '../conversations/DeleteChatDialog.tsx'

/** The project's chats, each with the chat row's menu. */
export function ProjectChats({
  chats,
  onUpdate,
  onRetitle,
  onDelete,
}: {
  chats: ConversationListItem[]
  onUpdate: (id: string, patch: ConversationPatch) => void
  onRetitle: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [toDelete, setToDelete] = useState<ConversationListItem | null>(null)
  if (chats.length === 0) return null
  return (
    <section className="project-chats" aria-label="Project chats">
      <h2>Chats</h2>
      {chats.map((item) => (
        <ConversationRow
          key={item.id}
          item={item}
          onRename={(title) => onUpdate(item.id, { title })}
          onRetitle={() => onRetitle(item.id)}
          onPin={() => onUpdate(item.id, { pinned: !item.pinned })}
          onArchive={() => onUpdate(item.id, { archived: true })}
          onDelete={() => setToDelete(item)}
          onRemoveFromProject={() => onUpdate(item.id, { projectId: null })}
        />
      ))}
      <DeleteChatDialog
        chat={toDelete}
        onDelete={onDelete}
        onClose={() => setToDelete(null)}
      />
    </section>
  )
}
