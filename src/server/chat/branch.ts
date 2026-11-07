import { replaceFileIds } from '../../shared/export.ts'
import { messageText } from '../../shared/messages.ts'
import type { Conversation } from '../../shared/types.ts'
import type { ConversationStore } from '../conversations/index.ts'
import type { FileStore } from '../file-store.ts'
import type { ChatService } from './chat-service.ts'
import type { Compactor } from './compactor.ts'

/** What `branchChat` needs. */
interface Branching {
  store: ConversationStore
  files: FileStore
  compactor: Compactor
  chat: ChatService
}

/**
 * Copies a chat up to the end of the turn that holds `itemId` (a message on
 * the version on screen) into a new chat, to carry on from there without
 * touching the original. It keeps the summaries that apply and copies the
 * pictures and files the copied messages use, so deleting either chat leaves
 * the other whole. Returns an error to show instead when it can't.
 */
export function branchChat(
  { store, files, compactor, chat }: Branching,
  conversationId: string,
  itemId: number,
): { conversation: Conversation } | { error: string; status: 404 | 409 } {
  const source = store.getConversation(conversationId)
  if (!source) return { error: 'Not found', status: 404 }
  if (source.temporary) {
    return {
      error: 'A temporary chat is not kept, so it can’t be branched',
      status: 409,
    }
  }
  const path = store.getPath(conversationId)
  const at = path.findIndex((item) => item.id === itemId)
  if (at < 0) return { error: 'That message is not in this chat', status: 404 }
  // To the end of its turn: up to, not including, the next user message.
  let end = at
  while (
    end + 1 < path.length &&
    messageText(path[end + 1]!.data)?.role !== 'user'
  ) {
    end++
  }
  const copied = path.slice(0, end + 1)
  if (chat.waitingCalls(conversationId, copied[end]!.id).length > 0) {
    return {
      error: 'This answer is waiting for a tool to be approved',
      status: 409,
    }
  }

  // The files these messages use, copied under new ids as `replaceFileIds`
  // meets them (so only real references count, not an id in message text).
  const owned = new Map(
    files.ofConversation(conversationId).map((file) => [file.id, file]),
  )
  const copies = new Map<string, string>()
  const copyOnUse = new (class extends Map<string, string> {
    override has(id: string) {
      const file = owned.get(id)
      if (file && !copies.has(id)) {
        copies.set(
          id,
          files.save(null, file.name, file.mime, files.read(id)).id,
        )
      }
      return copies.has(id)
    }
    override get(id: string) {
      return copies.get(id)
    }
  })()
  const items = replaceFileIds(
    copied.map((item, i) => ({
      id: item.id,
      parentId: i === 0 ? null : copied[i - 1]!.id,
      data: item.data,
      usage: item.usage,
      model: item.model,
      createdAt: item.createdAt,
    })),
    copyOnUse,
  )

  const conversation = store.importConversation({
    version: 2,
    conversation: {
      title: source.title && `Branch · ${source.title}`,
      // A new chat: at the top of the list, not among the old ones.
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    currentLeafId: copied[end]!.id,
    items,
  })
  files.link([...copies.values()], conversation.id)
  if (source.projectId) {
    store.updateConversation(conversation.id, { projectId: source.projectId })
  }

  // The copy has the same items in the same order: the summaries that apply
  // to the copied part follow them, as they were.
  const copy = store.getPath(conversation.id)
  const newIds = new Map(copied.map((item, i) => [item.id, copy[i]!.id]))
  const summaries = new Map<number, number>()
  for (const summary of compactor.onPath(conversationId, copied)) {
    const added = store.compactions.add(conversation.id, {
      ...summary,
      upToItemId: newIds.get(summary.upToItemId)!,
      previousId:
        summary.previousId && (summaries.get(summary.previousId) ?? null),
    })
    summaries.set(summary.id, added.id)
  }
  return { conversation: store.getConversation(conversation.id)! }
}
