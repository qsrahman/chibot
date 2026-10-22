import type { StoredItem } from '../shared/types.ts'

/** A history item as the chat shows it. */
export interface ChatMessage {
  key: string
  role: 'user' | 'assistant'
  text: string
}

/** Keeps user and assistant messages. Reasoning and tool items aren't shown yet. */
export function toChatMessages(items: StoredItem[]): ChatMessage[] {
  return items.flatMap((item) => {
    const data = item.data
    if (
      !('role' in data) ||
      (data.role !== 'user' && data.role !== 'assistant')
    )
      return []
    if ('type' in data && data.type !== undefined && data.type !== 'message')
      return []
    const text =
      typeof data.content === 'string'
        ? data.content
        : data.content
            .map((part) =>
              'text' in part
                ? part.text
                : 'refusal' in part
                  ? part.refusal
                  : '',
            )
            .join('')
    return [{ key: String(item.id), role: data.role, text }]
  })
}
