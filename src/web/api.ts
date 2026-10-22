import { EventSourceParserStream } from 'eventsource-parser/stream'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses'
import type {
  Conversation,
  ConversationListItem,
  ConversationPatch,
  ConversationWithItems,
  TurnErrorEvent,
  TurnTitleEvent,
} from '../shared/types.ts'

export type TurnEvent = ResponseStreamEvent | TurnErrorEvent | TurnTitleEvent

export interface Health {
  status: string
  model: string
  baseURL: string | null
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const getHealth = () => request<Health>('/api/health')

export const listConversations = ({ archived = false } = {}) =>
  request<ConversationListItem[]>(
    `/api/conversations${archived ? '?archived=1' : ''}`,
  )

export const searchConversations = (q: string, signal?: AbortSignal) =>
  request<ConversationListItem[]>(
    `/api/conversations?${new URLSearchParams({ q })}`,
    { signal },
  )

export const createConversation = ({ temporary = false } = {}) =>
  request<Conversation>('/api/conversations', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ temporary }),
  })

export const getConversation = (id: string) =>
  request<ConversationWithItems>(`/api/conversations/${id}`)

export const updateConversation = (id: string, patch: ConversationPatch) =>
  request<Conversation>(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  })

/** `keepalive` lets the request finish while the page is unloading. */
export async function deleteConversation(
  id: string,
  { keepalive = false } = {},
) {
  const res = await fetch(`/api/conversations/${id}`, {
    method: 'DELETE',
    keepalive,
  })
  if (!res.ok && res.status !== 404) throw new Error(await errorMessage(res))
}

/** Sends a message and yields the streamed events until the turn ends. */
export async function* streamTurn(
  conversationId: string,
  text: string,
  signal: AbortSignal,
): AsyncGenerator<TurnEvent> {
  const res = await fetch(`/api/conversations/${conversationId}/turns`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ text }),
    signal,
  })
  if (!res.ok) throw new Error(await errorMessage(res))
  // A reader loop rather than `for await`: Safari can't async-iterate streams.
  const reader = res
    .body!.pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    yield JSON.parse(value.data) as TurnEvent
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json() as Promise<T>
}

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? `HTTP ${res.status}`
}
