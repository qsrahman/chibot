import OpenAI from 'openai'
import type {
  ResponseCreateParams,
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

export interface TitleOptions {
  /** What the title request returns as `output_text`, or throws. */
  title?: string | Error | ((params: ResponseCreateParams) => string | Error)
  titleCalls?: ResponseCreateParams[]
}

/**
 * An OpenAI client whose streaming `responses.create` yields the given
 * events (or rejects with an error), honouring the abort signal between
 * events. Non-streaming calls are title requests: see `TitleOptions`.
 */
export function fakeClient(
  events: ResponseStreamEvent[] | Error,
  calls: FakeCall[] = [],
  { title = 'Test Title', titleCalls = [] }: TitleOptions = {},
): OpenAI {
  const create = async (
    params: ResponseCreateParams,
    options?: { signal?: AbortSignal },
  ) => {
    if (!params.stream) {
      titleCalls.push(structuredClone(params))
      const result = typeof title === 'function' ? title(params) : title
      if (result instanceof Error) throw result
      return { output_text: result }
    }
    calls.push({
      params: structuredClone(params) as ResponseCreateParamsStreaming,
      signal: options?.signal,
    })
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
