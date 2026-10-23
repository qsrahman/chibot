import { messageText } from '../shared/messages.ts'
import type { Conversation, StoredItem } from '../shared/types.ts'

/**
 * The conversation as shown (its current path) in Markdown.
 *
 * @param fileNames the chat's files by id, to list attachments
 */
export function toMarkdown(
  conversation: Conversation,
  path: StoredItem[],
  fileNames: Map<string, string>,
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
    const attached = attachedIds(data).map((id) => fileNames.get(id) ?? id)
    return [
      `## ${who}\n\n` +
        (attached.length ? `*Attached: ${attached.join(', ')}*\n\n` : '') +
        message.text.trim(),
    ]
  })
  return `# ${conversation.title ?? 'Chat'}\n\n${sections.join('\n\n')}\n`
}

/** The chibot file ids a message attaches. */
const attachedIds = (data: StoredItem['data']) =>
  'content' in data && Array.isArray(data.content)
    ? data.content.flatMap((part) =>
        (part.type === 'input_image' || part.type === 'input_file') &&
        part.file_id
          ? [part.file_id]
          : [],
      )
    : []

/** Keeps a multi-line text inside a blockquote. */
const quote = (text: string) => text.trim().replaceAll('\n', '\n> ')
