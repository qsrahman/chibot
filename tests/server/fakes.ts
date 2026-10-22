import OpenAI from 'openai'
import { ConversationStore } from '../../src/server/conversation-store.ts'
import { openDatabase } from '../../src/server/database.ts'
import {
  settingsDefaults,
  SettingsStore,
} from '../../src/server/settings-store.ts'
import type { Settings } from '../../src/shared/settings.ts'
import type {
  ResponseCreateParams,
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
  ResponseUsage,
} from 'openai/resources/responses/responses'

/** Collects everything a stream yields. */
export async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const seen: T[] = []
  for await (const item of stream) seen.push(item)
  return seen
}

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
  /** What `models.list()` yields, or the error it throws. */
  models?: string[] | Error
  /** Streaming calls with `reasoning` fail with 400, like non-reasoning models. */
  rejectReasoning?: boolean
}

/**
 * An OpenAI client whose streaming `responses.create` yields the given
 * events (or rejects with an error), honouring the abort signal between
 * events. Non-streaming calls are title requests: see `TitleOptions`.
 */
export function fakeClient(
  /** Per streaming call: the events, an error, or a function picking them. */
  events:
    ResponseStreamEvent[] | Error | ((call: number) => ResponseStreamEvent[]),
  calls: FakeCall[] = [],
  {
    title = 'Test Title',
    titleCalls = [],
    models = ['m-2', 'm-1'],
    rejectReasoning = false,
  }: TitleOptions = {},
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
    const streamed =
      typeof events === 'function' ? events(calls.length - 1) : events
    if (rejectReasoning && params.reasoning) {
      throw new OpenAI.BadRequestError(
        400,
        { message: 'reasoning is not supported' },
        'reasoning is not supported',
        new Headers(),
      )
    }
    return (async function* () {
      for (const event of streamed) {
        await Promise.resolve()
        if (options?.signal?.aborted) throw new OpenAI.APIUserAbortError()
        yield event
      }
    })()
  }
  async function* list() {
    if (models instanceof Error) throw models
    for (const id of models) yield { id }
  }
  return { responses: { create }, models: { list } } as unknown as OpenAI
}

/** A conversation store on a fresh in-memory database. */
export const memoryStore = () => new ConversationStore(openDatabase(':memory:'))

/** Settings with `model` (and any overrides), on their own in-memory database. */
export function testSettings(model = 'm', overrides: Partial<Settings> = {}) {
  const settings = new SettingsStore(
    openDatabase(':memory:'),
    settingsDefaults(model),
  )
  settings.update(overrides)
  return settings
}
