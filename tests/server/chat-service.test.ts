import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import { ChatService } from '../../src/server/chat-service.ts'
import { ConversationStore } from '../../src/server/conversation-store.ts'
import {
  answerEvents,
  drain,
  fakeClient,
  usage,
  type FakeCall,
} from './fakes.ts'

describe('ChatService', () => {
  let store: ConversationStore
  let conversationId: string
  beforeEach(() => {
    store = new ConversationStore(':memory:')
    conversationId = store.createConversation().id
  })
  afterEach(() => store.close())

  it('streams events and persists the turn statelessly', async () => {
    const calls: FakeCall[] = []
    const events = answerEvents('Hel', 'lo')
    const chat = new ChatService(fakeClient(events, calls), store, 'model-x')

    expect(await drain(chat.sendMessage(conversationId, 'Hi'))).toEqual([
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
    const chat = new ChatService(fakeClient(answerEvents('ok')), store, 'm')
    for await (const event of chat.sendMessage(conversationId, 'Hi')) {
      if (event.type === 'response.completed') {
        expect(store.getPath(conversationId)).toHaveLength(2)
      }
    }
  })

  it('sends the full history on later turns', async () => {
    const calls: FakeCall[] = []
    const chat = new ChatService(
      fakeClient(answerEvents('A'), calls),
      store,
      'm',
    )
    await drain(chat.sendMessage(conversationId, 'one'))
    await drain(chat.sendMessage(conversationId, 'two'))

    expect(calls[1]!.params.input).toEqual([
      { role: 'user', content: 'one' },
      expect.objectContaining({ type: 'message' }),
      { role: 'user', content: 'two' },
    ])
  })

  it('keeps the partial answer when the consumer stops early', async () => {
    const chat = new ChatService(
      fakeClient(answerEvents('Par', 'tial', ' rest')),
      store,
      'm',
    )
    let n = 0
    for await (const _ of chat.sendMessage(conversationId, 'Hi')) {
      if (++n === 2) break
    }
    expect(store.getPath(conversationId).map((i) => i.data)).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Partial' },
    ])
  })

  it('keeps the partial answer when aborted', async () => {
    const controller = new AbortController()
    const chat = new ChatService(
      fakeClient(answerEvents('Par', 'tial', ' rest')),
      store,
      'm',
    )
    const run = async () => {
      for await (const event of chat.sendMessage(
        conversationId,
        'Hi',
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
    const chat = new ChatService(fakeClient(error), store, 'm')
    await expect(drain(chat.sendMessage(conversationId, 'Hi'))).rejects.toBe(
      error,
    )
    expect(store.getPath(conversationId).map((i) => i.data)).toEqual([
      { role: 'user', content: 'Hi' },
    ])
  })
})
