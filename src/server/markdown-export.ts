import { messageText } from '../shared/messages.ts'
import type { Conversation, StoredItem } from '../shared/types.ts'

/** The conversation as shown (its current path) in Markdown. */
export function toMarkdown(
  conversation: Conversation,
  path: StoredItem[],
): string {
  const outputs = new Map(
    path.flatMap(({ data }) =>
      data.type === 'function_call_output' ? [[data.call_id, data.output]] : [],
    ),
  )
  const sections = path.flatMap((item) => {
    const { data } = item
    if (data.type === 'function_call') {
      const output = outputs.get(data.call_id)
      return [
        `> Used **${data.name}** with \`${data.arguments}\`` +
          (typeof output === 'string' ? `:\n>\n> ${quote(output)}` : ''),
      ]
    }
    const message = messageText(data)
    if (!message) return []
    const who =
      message.role === 'user'
        ? 'You'
        : `Assistant${item.model ? ` (${item.model})` : ''}`
    return [`## ${who}\n\n${message.text.trim()}`]
  })
  return `# ${conversation.title ?? 'Chat'}\n\n${sections.join('\n\n')}\n`
}

/** Keeps a multi-line text inside a blockquote. */
const quote = (text: string) => text.trim().replaceAll('\n', '\n> ')
