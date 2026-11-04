import type { Conversation } from '../../shared/types.ts'
import { ConfirmDialog } from '../ui/Dialog.tsx'
import { UNTITLED } from './useConversations.ts'

/** Asks before deleting `chat`; open while `chat` is set. */
export function DeleteChatDialog({
  chat,
  onDelete,
  onClose,
}: {
  chat: Conversation | null
  onDelete: (id: string) => void
  onClose: () => void
}) {
  return (
    <ConfirmDialog
      open={chat !== null}
      title="Delete chat?"
      message={
        <>
          This will delete <strong>{chat?.title ?? UNTITLED}</strong> and all
          its messages. This can't be undone.
        </>
      }
      confirmLabel="Delete"
      onConfirm={() => chat && onDelete(chat.id)}
      onClose={onClose}
    />
  )
}
