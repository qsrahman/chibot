import { beforeEach, describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import { ConversationStore } from '../../src/server/conversation-store.ts'
import {
  answerEvents,
  drain,
  usage,
  type FakeCall,
  memoryStore,
  testChat,
} from './fakes.ts'

describe('ChatService', () => {
  let store: ConversationStore
  let conversationId: string
  beforeEach(() => {
    store = memoryStore()
    conversationId = store.createConversation().id
  })

  it('streams events and persists the turn statelessly', async () => {
    const calls: FakeCall[] = []
    const events = answerEvents('Hel', 'lo')
    const chat = testChat(events, { store, calls, model: 'model-x' })

    expect(await drain(chat.runTurn(conversationId, { text: 'Hi' }))).toEqual([
      ...events,
      { type: 'chibot.title', title: 'Test Title' },
    ])

    expect(calls[0]!.params).toMatchObject({
      model: 'model-x',
      input: [{ role: 'user', content: 'Hi' }],
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
    })
    const path = store.getPath(conversationId)
    expect(path.map((i) => i.data)).toEqual([
      { role: 'user', content: 'Hi' },
      expect.objectContaining({ type: 'message', role: 'assistant' }),
    ])
    expect(path[1]!.usage).toEqual(usage)
  })

  it('persists the answer before yielding response.completed', async () => {
    const chat = testChat(answerEvents('ok'), { store })
    for await (const event of chat.runTurn(conversationId, { text: 'Hi' })) {
      if (event.type === 'response.completed') {
        expect(store.getPath(conversationId)).toHaveLength(2)
      }
    }
  })

  it('sends the full history on later turns', async () => {
    const calls: FakeCall[] = []
    const chat = testChat(answerEvents('A'), { store, calls })
    await drain(chat.runTurn(conversationId, { text: 'one' }))
    await drain(chat.runTurn(conversationId, { text: 'two' }))

    expect(calls[1]!.params.input).toEqual([
      { role: 'user', content: 'one' },
      expect.objectContaining({ type: 'message' }),
      { role: 'user', content: 'two' },
    ])
  })

  it('keeps the partial answer when the consumer stops early', async () => {
    const chat = testChat(answerEvents('Par', 'tial', ' rest'), { store })
    let n = 0
    for await (const _ of chat.runTurn(conversationId, { text: 'Hi' })) {
      if (++n === 2) break
    }
    expect(store.getPath(conversationId).map((i) => i.data)).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Partial' },
    ])
  })

  it('keeps the partial answer when aborted', async () => {
    const controller = new AbortController()
    const chat = testChat(answerEvents('Par', 'tial', ' rest'), { store })
    const run = async () => {
      for await (const event of chat.runTurn(
        conversationId,
        { text: 'Hi' },
        controller.signal,
      )) {
        if ('delta' in event && event.delta === 'tial') controller.abort()
      }
    }
    await expect(run()).rejects.toBeInstanceOf(OpenAI.APIUserAbortError)
    expect(store.getPath(conversationId).at(-1)!.data).toEqual({
      role: 'assistant',
      content: 'Partial',
    })
  })

  it('keeps the user message when the request fails', async () => {
    const error = new OpenAI.AuthenticationError(
      401,
      { message: 'bad key' },
      'bad key',
      new Headers(),
    )
    const chat = testChat(error, { store })
    await expect(
      drain(chat.runTurn(conversationId, { text: 'Hi' })),
    ).rejects.toBe(error)
    expect(store.getPath(conversationId).map((i) => i.data)).toEqual([
      { role: 'user', content: 'Hi' },
    ])
  })
})
