import { EventSourceParserStream } from 'eventsource-parser/stream'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses'
import type {
  Conversation,
  ConversationWithItems,
  TurnErrorEvent,
} from '../shared/types.ts'

export type TurnEvent = ResponseStreamEvent | TurnErrorEvent

export interface Health {
  status: string
  model: string
  baseURL: string | null
}

export const getHealth = () => request<Health>('/api/health')

export const createConversation = () =>
  request<Conversation>('/api/conversations', { method: 'POST' })

export const getConversation = (id: string) =>
  request<ConversationWithItems>(`/api/conversations/${id}`)

/** Sends a message and yields the streamed events until the turn ends. */
export async function* streamTurn(
  conversationId: string,
  text: string,
  signal: AbortSignal,
): AsyncGenerator<TurnEvent> {
  const res = await fetch(`/api/conversations/${conversationId}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
