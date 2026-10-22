import OpenAI from 'openai'
import type {
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
  ResponseUsage,
} from 'openai/resources/responses/responses'

export const usage = {
  input_tokens: 12,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: 3,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 15,
} as ResponseUsage

/** A streamed answer: one delta per chunk, then `response.completed`. */
export function answerEvents(...chunks: string[]): ResponseStreamEvent[] {
  const text = chunks.join('')
  const message = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  } as unknown as ResponseInputItem
  return [
    ...chunks.map((delta) => ({ type: 'response.output_text.delta', delta })),
    { type: 'response.completed', response: { output: [message], usage } },
  ] as unknown as ResponseStreamEvent[]
}

export interface FakeCall {
  params: ResponseCreateParamsStreaming
  signal: AbortSignal | undefined
}

/**
 * An OpenAI client whose `responses.create` streams the given events, or
 * rejects with `error`. It honours the abort signal between events.
 */
export function fakeClient(
  events: ResponseStreamEvent[] | Error,
  calls: FakeCall[] = [],
): OpenAI {
  const create = async (
    params: ResponseCreateParamsStreaming,
    options?: { signal?: AbortSignal },
  ) => {
    calls.push({ params: structuredClone(params), signal: options?.signal })
    if (events instanceof Error) throw events
    return (async function* () {
      for (const event of events) {
        await Promise.resolve()
        if (options?.signal?.aborted) throw new OpenAI.APIUserAbortError()
        yield event
      }
    })()
  }
  return { responses: { create } } as unknown as OpenAI
}
