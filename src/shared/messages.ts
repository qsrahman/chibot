import type { ResponseInputItem } from 'openai/resources/responses/responses'

export interface MessageText {
  role: 'user' | 'assistant'
  text: string
}

/**
 * The visible text of a user or assistant message, or `null` for anything
 * else (reasoning, tool calls, system messages, …).
 */
export function messageText(data: ResponseInputItem): MessageText | null {
  if (!('role' in data) || (data.role !== 'user' && data.role !== 'assistant'))
    return null
  if ('type' in data && data.type !== undefined && data.type !== 'message')
    return null
  const text =
    typeof data.content === 'string'
      ? data.content
      : data.content
          .map((part) =>
            'text' in part ? part.text : 'refusal' in part ? part.refusal : '',
          )
          .join('')
  return { role: data.role, text }
}
