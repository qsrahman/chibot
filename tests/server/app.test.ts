import { beforeEach, describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses'
import {
  EventSourceParserStream,
  type EventSourceMessage,
} from 'eventsource-parser/stream'
import { ChatService } from '../../src/server/chat-service.ts'
import { ToolRegistry } from '../../src/server/tool-registry.ts'
import { Config } from '../../src/server/config.ts'
import { ConversationStore } from '../../src/server/conversation-store.ts'
import type {
  Conversation,
  ConversationWithItems,
} from '../../src/shared/types.ts'
import {
  answerEvents,
  EchoTool,
  fakeClient,
  memoryStore,
  testSettings,
  testApp,
} from './fakes.ts'

const config = new Config({
  OPENAI_API_KEY: 'secret',
  OPENAI_BASE_URL: 'http://localhost:1234/v1',
  OPENAI_MODEL: 'm-1',
})

async function readEvents(res: Response): Promise<EventSourceMessage[]> {
  const events: EventSourceMessage[] = []
  const stream = res
    .body!.pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
  for await (const event of stream) events.push(event)
  return events
}

describe('API', () => {
  let store: ConversationStore
  beforeEach(() => {
    store = memoryStore()
  })

  function appWith(events: ResponseStreamEvent[] | Error) {
    const settings = testSettings('m-1')
    const chat = new ChatService(fakeClient(events), store, settings)
    return testApp({
      config,
      store,
      settings,
      chat,
    })
  }

  async function createConversation(app: ReturnType<typeof appWith>) {
    const res = await app.request('/api/conversations', { method: 'POST' })
    expect(res.status).toBe(201)
    return (await res.json()) as Conversation
  }

  function postTurn(
    app: ReturnType<typeof appWith>,
    id: string,
    body: unknown,
  ) {
    return app.request(`/api/conversations/${id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('GET /api/health reports model and endpoint without the key', async () => {
    const res = await appWith([]).request('/api/health')
    expect(await res.json()).toEqual({
      status: 'ok',
      model: 'm-1',
      baseURL: 'http://localhost:1234/v1',
      // A compatible server without a transcription model: no mic.
      features: { transcription: false },
    })
  })

  it('GET /api/tools lists the tools with their labels', async () => {
    const settings = testSettings('m-1')
    const chat = new ChatService(
      fakeClient([]),
      store,
      settings,
      new ToolRegistry([new EchoTool()]),
    )
    const app = testApp({
      config,
      store,
      settings,
      chat,
    })
    expect(await (await app.request('/api/tools')).json()).toEqual({
      tools: [{ name: 'echo', label: 'Echo' }],
    })
  })

  it('creates and reads a conversation', async () => {
    const app = appWith([])
    const created = await createConversation(app)
    const res = await app.request(`/api/conversations/${created.id}`)
    expect(await res.json()).toEqual({
      conversation: created,
      items: [],
      usage: {
        input_tokens: 0,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 0,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 0,
      },
    })
  })

  it('returns 404 for unknown conversations and API routes', async () => {
    const app = appWith([])
    expect((await app.request('/api/conversations/nope')).status).toBe(404)
    expect((await postTurn(app, 'nope', { text: 'hi' })).status).toBe(404)
    expect((await app.request('/api/nope')).status).toBe(404)
  })

  it('rejects an empty message', async () => {
    const app = appWith([])
    const { id } = await createConversation(app)
    expect((await postTurn(app, id, { text: '  ' })).status).toBe(400)
    expect((await postTurn(app, id, {})).status).toBe(400)
  })

  it('streams SDK events as SSE and persists the turn', async () => {
    const events = answerEvents('Hi', ' there')
    const app = appWith(events)
    const { id } = await createConversation(app)

    const res = await postTurn(app, id, { text: 'Hello' })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const received = await readEvents(res)
    expect(received.map((e) => e.event)).toEqual([
      ...events.map((e) => e.type),
      'chibot.title',
    ])
    expect(received.map((e) => JSON.parse(e.data))).toEqual([
      ...events,
      { type: 'chibot.title', title: 'Test Title' },
    ])

    const body = (await (
      await app.request(`/api/conversations/${id}`)
    ).json()) as ConversationWithItems
    expect(body.items).toHaveLength(2)
  })

  it('reports upstream errors as a chibot.error event', async () => {
    const error = new OpenAI.AuthenticationError(
      401,
      { message: 'Incorrect API key' },
      'Incorrect API key',
      new Headers({ 'x-request-id': 'req_123' }),
    )
    const app = appWith(error)
    const { id } = await createConversation(app)

    const [event, ...rest] = await readEvents(
      await postTurn(app, id, { text: 'Hello' }),
    )
    expect(rest).toEqual([])
    expect(event!.event).toBe('chibot.error')
    expect(JSON.parse(event!.data)).toEqual({
      type: 'chibot.error',
      message: expect.stringContaining('Incorrect API key'),
      status: 401,
      requestId: 'req_123',
    })
  })
})
