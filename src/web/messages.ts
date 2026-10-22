import { messageText, type MessageText } from '../shared/messages.ts'
import type { StoredItem } from '../shared/types.ts'

/** A history item as the chat shows it. */
export interface ChatMessage extends MessageText {
  key: string
}

/** Keeps user and assistant messages. Reasoning and tool items aren't shown yet. */
export function toChatMessages(items: StoredItem[]): ChatMessage[] {
  return items.flatMap((item) => {
    const message = messageText(item.data)
    return message ? [{ key: String(item.id), ...message }] : []
  })
}
