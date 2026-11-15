import { fileParts, messageText } from '../../shared/messages.ts'
import { NEXT_STEP_TOOL } from '../../shared/tools.ts'
import type { Conversation, StoredItem } from '../../shared/types.ts'

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
    if (data.type === 'function_call' && data.name === NEXT_STEP_TOOL) {
      // The card's offer, as the plain line a reader would see.
      const { title, prompt } = parseArguments(data.arguments)
      return typeof title === 'string' && typeof prompt === 'string'
        ? [`> **Next step:** ${title} (“${prompt}”)`]
        : []
    }
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
    const attached = fileParts(data).flatMap(({ file_id: id }) =>
      id ? [fileNames.get(id) ?? id] : [],
    )
    return [
      `## ${who}\n\n` +
        (attached.length ? `*Attached: ${attached.join(', ')}*\n\n` : '') +
        message.text.trim(),
    ]
  })
  return `# ${conversation.title ?? 'Chat'}\n\n${sections.join('\n\n')}\n`
}

function parseArguments(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Keeps a multi-line text inside a blockquote. */
const quote = (text: string) => text.trim().replaceAll('\n', '\n> ')
