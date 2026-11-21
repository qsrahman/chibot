import { beforeEach, describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import { ConversationStore } from '../../../src/server/conversations/index.ts'
import { isDroppedStream } from '../../../src/server/chat/stream-retry.ts'
import {
  answerEvents,
  drain,
  memoryStore,
  testChat,
  type FakeCall,
} from '../fakes.ts'

const terminated = () =>
  new TypeError('terminated', { cause: new Error('other side closed') })

describe('isDroppedStream', () => {
  it('is a cut connection, not something the server said', () => {
    expect(isDroppedStream(terminated())).toBe(true)
    expect(
      isDroppedStream(new OpenAI.APIConnectionError({ message: 'reset' })),
    ).toBe(true)
    expect(
      isDroppedStream(new OpenAI.APIConnectionTimeoutError({ message: 'x' })),
    ).toBe(true)
    expect(isDroppedStream(new OpenAI.APIUserAbortError())).toBe(false)
    expect(
      isDroppedStream(
        new OpenAI.InternalServerError(500, {}, 'boom', new Headers()),
      ),
    ).toBe(false)
    expect(isDroppedStream(new Error('bug'))).toBe(false)
  })
})

describe('a stream that drops before any output', () => {
  let store: ConversationStore
  let id: string
  beforeEach(() => {
    store = memoryStore()
    id = store.createConversation().id
  })

  it('is asked again, and the user sees only the answer', async () => {
    const calls: FakeCall[] = []
    const answer = answerEvents('Hel', 'lo')
    const chat = testChat((call) => (call === 0 ? [terminated()] : answer), {
      store,
      calls,
    })
    const events = await drain(chat.runTurn(id, { text: 'Hi' }))
    expect(calls).toHaveLength(2)
    expect(events.filter((e) => e.type === 'response.completed')).toHaveLength(
      1,
    )
    expect(store.getPath(id).map((i) => i.data)).toHaveLength(2)
  })

  it('is asked at most twice more, then fails', async () => {
    const calls: FakeCall[] = []
    const chat = testChat(() => [terminated()], { store, calls })
    await expect(drain(chat.runTurn(id, { text: 'Hi' }))).rejects.toThrow(
      'terminated',
    )
    expect(calls).toHaveLength(3)
  })

  it('is not asked again once the model has begun answering', async () => {
    const calls: FakeCall[] = []
    const answer = answerEvents('Hel', 'lo')
    const chat = testChat(() => [...answer.slice(0, -1), terminated()], {
      store,
      calls,
    })
    await expect(drain(chat.runTurn(id, { text: 'Hi' }))).rejects.toThrow(
      'terminated',
    )
    expect(calls).toHaveLength(1)
  })

  it('is not asked again when the server refused the request', async () => {
    const calls: FakeCall[] = []
    const refused = new OpenAI.InternalServerError(
      500,
      {},
      'boom',
      new Headers(),
    )
    const chat = testChat(refused, { store, calls })
    await expect(drain(chat.runTurn(id, { text: 'Hi' }))).rejects.toThrow('500')
    expect(calls).toHaveLength(1)
  })
})
