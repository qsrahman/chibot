import { messageText } from '../shared/messages.ts'
import type { Conversation, StoredItem } from '../shared/types.ts'

/** The conversation as shown (its current path) in Markdown. */
export function toMarkdown(
  conversation: Conversation,
  path: StoredItem[],
): string {
  const sections = path.flatMap((item) => {
    const message = messageText(item.data)
    if (!message) return []
    const who =
      message.role === 'user'
        ? 'You'
        : `Assistant${item.model ? ` (${item.model})` : ''}`
    return [`## ${who}\n\n${message.text.trim()}`]
  })
  return `# ${conversation.title ?? 'Chat'}\n\n${sections.join('\n\n')}\n`
}
