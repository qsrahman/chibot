import { beforeEach, describe, expect, it, vi } from 'vitest'
import OpenAI from 'openai'
import type { ResponseCreateParams } from 'openai/resources/responses/responses'
import { ChatService } from '../../src/server/chat-service.ts'
import { ConversationStore } from '../../src/server/conversation-store.ts'
import {
  answerEvents,
  drain,
  fakeClient,
  type TitleOptions,
  memoryStore,
  testSettings,
} from './fakes.ts'

const eventTypes = async (stream: AsyncIterable<{ type: string }>) =>
  (await drain(stream)).map((event) => event.type)

const badRequest = () =>
  new OpenAI.BadRequestError(
    400,
    { message: 'reasoning not supported' },
    'reasoning not supported',
    new Headers(),
  )

describe('ChatService titles', () => {
  let store: ConversationStore
  beforeEach(() => {
    store = memoryStore()
  })

  function service(options: TitleOptions) {
    return new ChatService(
      fakeClient(answerEvents('A'), [], options),
      store,
      testSettings('m'),
    )
  }

  it('titles a conversation once, from its opening messages', async () => {
    const titleCalls: ResponseCreateParams[] = []
    const chat = service({ title: 'Pangolin Facts', titleCalls })
    const { id } = store.createConversation()

    expect(
      await eventTypes(chat.runTurn(id, { text: 'Tell me about pangolins' })),
    ).toContain('chibot.title')
    expect(store.getConversation(id)!.title).toBe('Pangolin Facts')
    expect(titleCalls[0]).toMatchObject({
      model: 'm',
      store: false,
      reasoning: { effort: 'low' },
    })
    expect(titleCalls[0]!.input).toContain('user: Tell me about pangolins')

    expect(await eventTypes(chat.runTurn(id, { text: 'More?' }))).not.toContain(
      'chibot.title',
    )
    expect(titleCalls).toHaveLength(1)
  })

  it('retries without reasoning when the model rejects it', async () => {
    const titleCalls: ResponseCreateParams[] = []
    const chat = service({
      titleCalls,
      title: (params) => (params.reasoning ? badRequest() : 'Plain Title'),
    })
    const { id } = store.createConversation()
    await eventTypes(chat.runTurn(id, { text: 'Hi' }))

    expect(titleCalls.map((p) => p.reasoning)).toEqual([
      { effort: 'low' },
      undefined,
    ])
    expect(store.getConversation(id)!.title).toBe('Plain Title')
  })

  it('cleans quotes, Markdown and a trailing full stop', async () => {
    const chat = service({ title: '**"Trip to Lisbon."**\nextra line' })
    const { id } = store.createConversation()
    await eventTypes(chat.runTurn(id, { text: 'Hi' }))
    expect(store.getConversation(id)!.title).toBe('Trip to Lisbon')
  })

  it('leaves the title empty when generation fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const chat = service({ title: new Error('boom') })
    const { id } = store.createConversation()

    expect(await eventTypes(chat.runTurn(id, { text: 'Hi' }))).not.toContain(
      'chibot.title',
    )
    expect(store.getConversation(id)!.title).toBeNull()
    vi.restoreAllMocks()
  })

  it('never titles temporary chats', async () => {
    const titleCalls: ResponseCreateParams[] = []
    const chat = service({ titleCalls })
    const { id } = store.createConversation({ temporary: true })
    await eventTypes(chat.runTurn(id, { text: 'Hi' }))
    expect(titleCalls).toEqual([])
  })
})
