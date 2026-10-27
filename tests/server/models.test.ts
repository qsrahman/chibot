import { describe, expect, it, vi } from 'vitest'
import OpenAI from 'openai'
import { ChatService } from '../../src/server/chat-service.ts'
import {
  answerEvents,
  drain,
  fakeClient,
  memoryStore,
  testSettings,
  testChat,
} from './fakes.ts'

describe('models', () => {
  it('lists the endpoint models, sorted', async () => {
    const chat = testChat([])
    expect(await chat.listModels()).toEqual(['m-1', 'm-2'])
  })

  it('returns null when the endpoint cannot list models', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = fakeClient([], [], {
      models: new OpenAI.NotFoundError(404, {}, 'nope', new Headers()),
    })
    const chat = new ChatService(client, memoryStore(), testSettings())
    expect(await chat.listModels()).toBeNull()
    vi.restoreAllMocks()
  })

  it('records the model that wrote each answer', async () => {
    const store = memoryStore()
    const settings = testSettings('first')
    const chat = testChat(answerEvents('a'), { store, settings })
    const { id } = store.createConversation()
    await drain(chat.runTurn(id, { text: 'q' }))
    const question = store.getPath(id)[0]!
    settings.update({ model: 'second' })
    await drain(chat.runTurn(id, { parentId: question.id }))

    expect(store.getPath(id).map((i) => i.model)).toEqual([null, 'second'])
    store.switchToVersion(id, store.getPath(id)[1]!.siblingIds[0]!)
    expect(store.getPath(id)[1]!.model).toBe('first')
  })

  it('prefers the model the server reports', async () => {
    const store = memoryStore()
    const events = answerEvents('a')
    const completed = events.at(-1) as { response: { model?: string } }
    completed.response.model = 'first-2026-10-01'
    const chat = testChat(events, { store, model: 'first' })
    const { id } = store.createConversation()
    await drain(chat.runTurn(id, { text: 'q' }))
    expect(store.getPath(id).at(-1)!.model).toBe('first-2026-10-01')
  })

  it('records the model for a stopped answer too', async () => {
    const store = memoryStore()
    const chat = testChat(answerEvents('Par', 'tial', ' rest'), {
      store,
      model: 'slow-model',
    })
    const { id } = store.createConversation()
    let n = 0
    for await (const _ of chat.runTurn(id, { text: 'q' })) if (++n === 2) break
    expect(store.getPath(id).at(-1)).toMatchObject({
      data: { role: 'assistant', content: 'Partial' },
      model: 'slow-model',
    })
  })
})
