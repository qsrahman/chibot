import type {
  Conversation,
  ConversationListItem,
  ConversationPatch,
  ConversationWithItems,
} from '../../shared/types.ts'
import { JSON_HEADERS, remove, request, send } from '../http.ts'

export const listConversations = ({ archived = false } = {}) =>
  request<ConversationListItem[]>(
    `/api/conversations${archived ? '?archived=1' : ''}`,
  )

export const searchConversations = (q: string, signal?: AbortSignal) =>
  request<ConversationListItem[]>(
    `/api/conversations?${new URLSearchParams({ q })}`,
    { signal },
  )

export const createConversation = (options: {
  temporary?: boolean
  projectId?: string
}) => request<Conversation>('/api/conversations', send('POST', options))

export const getConversation = (id: string) =>
  request<ConversationWithItems>(`/api/conversations/${id}`)

export const updateConversation = (id: string, patch: ConversationPatch) =>
  request<Conversation>(`/api/conversations/${id}`, send('PATCH', patch))

/** `keepalive` lets the request finish while the page is unloading. */
export const deleteConversation = (id: string, { keepalive = false } = {}) =>
  remove(`/api/conversations/${id}`, { keepalive })

/** A new chat with this one up to the end of the turn holding `itemId`. */
export const branchConversation = (id: string, itemId: number) =>
  request<Conversation>(
    `/api/conversations/${id}/branch`,
    send('POST', { itemId }),
  )

/** Has the model name the chat again; resolves to the new title. */
export const regenerateTitle = (id: string) =>
  request<{ title: string }>(`/api/conversations/${id}/title`, {
    method: 'POST',
  })

/** Where to download a conversation as Markdown or JSON. */
export const exportUrl = (id: string, format: 'md' | 'json') =>
  `/api/conversations/${id}/export?format=${format}`

/** Adds a chat from an exported JSON file; the server validates it. */
export const importConversation = async (file: File) =>
  request<Conversation>('/api/conversations/import', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: await file.text(),
  })
