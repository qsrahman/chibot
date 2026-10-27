import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OpenAI from 'openai'
import { messageText } from '../../src/shared/messages.ts'
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

  describe('a message sent right after Stop', () => {
    afterEach(() => vi.useRealTimers())

    /** What the chat reads, in order: `role: text`. */
    const said = () =>
      store
        .getPath(conversationId)
        .flatMap((item) => messageText(item.data) ?? [])
        .map(({ role, text }) => `${role}: ${text}`)

    /** Stops a turn that is mid-answer, without it having unwound yet. */
    async function stopped(chat: ReturnType<typeof testChat>) {
      const controller = new AbortController()
      const first = chat.runTurn(
        conversationId,
        { text: 'one' },
        controller.signal,
      )
      await first.next() // 'Par' arrived
      controller.abort() // Stop: the turn saves its partial only when it unwinds
      return first
    }

    // The server learns of a disconnect a moment after a new request can
    // arrive, so the new turn must not read the chat before the stopped one
    // has saved what it got: it would answer from the wrong place, and the
    // partial answer would end up on a branch of its own.
    it('follows the partial answer the stopped turn saves', async () => {
      const chat = testChat(answerEvents('Par', 'tial'), { store })
      const first = await stopped(chat)

      const second = chat.runTurn(conversationId, { text: 'two' })
      const next = second.next()
      await new Promise((resolve) => setImmediate(resolve))
      // Held back, not yet read the chat or saved anything.
      expect(said()).toEqual(['user: one'])

      await first.return(undefined) // the stopped turn unwinds
      await next
      await drain(second)

      expect(said()).toEqual([
        'user: one',
        'assistant: Par',
        'user: two',
        'assistant: Partial',
      ])
    })

    it('does not wait for the previous turn’s title', async () => {
      const release = Promise.withResolvers<string>()
      const chat = testChat(answerEvents('A'), {
        store,
        client: { title: () => release.promise },
      })
      const first = chat.runTurn(conversationId, { text: 'one' })
      for (;;) {
        const { value } = await first.next()
        if (value.type === 'response.completed') break
      }
      void first.next() // now generating the title, which is still pending

      await chat.runTurn(conversationId, { text: 'two' }).next()
      expect(said().slice(0, 3)).toEqual([
        'user: one',
        'assistant: A',
        'user: two',
      ])
      release.resolve('Title')
    })

    it('does not wait for a turn that never unwinds', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const chat = testChat(answerEvents('Par', 'tial'), { store })
      await stopped(chat) // never closed

      const second = chat.runTurn(conversationId, { text: 'two' })
      const done = drain(second)
      await vi.advanceTimersByTimeAsync(10_000)
      await done

      expect(said().at(-2)).toBe('user: two')
    })
  })
})
