import { EventSourceParserStream } from 'eventsource-parser/stream'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses'
import type {
  Compaction,
  TurnApprovalEvent,
  TurnCompactionEvent,
  TurnErrorEvent,
  TurnRequest,
  TurnTitleEvent,
  TurnToolOutputEvent,
} from '../../shared/types.ts'
import {
  apiFetch,
  asNetworkError,
  errorMessage,
  remove,
  request,
  send,
} from '../http.ts'

export type TurnEvent =
  | ResponseStreamEvent
  | TurnApprovalEvent
  | TurnCompactionEvent
  | TurnErrorEvent
  | TurnTitleEvent
  | TurnToolOutputEvent

/** Turns a recording into text (`health.features.transcription`). */
export async function transcribe(audio: Blob, signal?: AbortSignal) {
  const form = new FormData()
  // e.g. audio/webm;codecs=opus → recording.webm
  form.append(
    'file',
    audio,
    `recording.${/\/(\w+)/.exec(audio.type)?.[1] ?? 'webm'}`,
  )
  return (
    await request<{ text: string }>('/api/transcriptions', {
      method: 'POST',
      body: form,
      signal,
    })
  ).text
}

/** Shows another version of a message or answer (see `Versions`). */
export const switchVersion = (conversationId: string, itemId: number) =>
  request<void>(
    `/api/conversations/${conversationId}/leaf`,
    send('PUT', { itemId }),
  )

/** Summarizes the start of the chat now, keeping `focus` in mind. */
export const compactChat = (
  conversationId: string,
  focus: string,
  signal: AbortSignal,
) =>
  request<Compaction>(`/api/conversations/${conversationId}/compact`, {
    ...send('POST', focus ? { focus } : {}),
    signal,
  })

/** Undo: brings back the messages a summary stood for. */
export const undoCompaction = (conversationId: string, compactionId: number) =>
  remove(`/api/conversations/${conversationId}/compactions/${compactionId}`)

/** Runs a turn and yields the streamed events until it ends. */
export async function* streamTurn(
  conversationId: string,
  request: TurnRequest,
  signal: AbortSignal,
): AsyncGenerator<TurnEvent> {
  const res = await apiFetch(`/api/conversations/${conversationId}/turns`, {
    ...send('POST', request),
    signal,
  })
  if (!res.ok) throw new Error(await errorMessage(res))
  // A reader loop rather than `for await`: Safari can't async-iterate streams.
  const reader = res
    .body!.pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader()
  for (;;) {
    // The server going away mid-answer ends the stream with a network error.
    const { done, value } = await reader.read().catch((err: unknown) => {
      throw asNetworkError(err)
    })
    if (done) return
    yield JSON.parse(value.data) as TurnEvent
  }
}
