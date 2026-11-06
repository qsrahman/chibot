import { describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import {
  answerEvents,
  drain,
  memoryStore,
  testSettings,
  type FakeCall,
  testChat,
} from './fakes.ts'

describe('reasoning', () => {
  async function turns(
    settings: ReturnType<typeof testSettings>,
    options: { rejectReasoning?: boolean } = {},
    count = 1,
  ) {
    const calls: FakeCall[] = []
    const store = memoryStore()
    const chat = testChat(answerEvents('a'), {
      store,
      calls,
      client: options,
      settings,
    })
    const { id } = store.createConversation({ temporary: true })
    for (let i = 0; i < count; i++) {
      await drain(chat.runTurn(id, { text: `q${i}` }))
    }
    return calls.map((c) => c.params.reasoning)
  }

  it('asks for a summary, and sends the effort only when set', async () => {
    expect(await turns(testSettings())).toEqual([{ summary: 'auto' }])
    expect(await turns(testSettings('m', { reasoningEffort: 'high' }))).toEqual(
      [{ summary: 'auto', effort: 'high' }],
    )
  })

  it('retries without reasoning when the model rejects it, then skips it', async () => {
    const sent = await turns(testSettings(), { rejectReasoning: true }, 2)
    // Turn 1: rejected, then retried plain. Turn 2: plain straight away.
    expect(sent).toEqual([{ summary: 'auto' }, undefined, undefined])
  })

  it('works on a server that rejects the request for reasoning items’ encrypted content', async () => {
    const calls: FakeCall[] = []
    const store = memoryStore()
    const chat = testChat(answerEvents('a'), {
      store,
      calls,
      client: {
        reject: (params) =>
          params.include
            ? new OpenAI.BadRequestError(
                400,
                { message: 'unknown include' },
                'unknown include',
                new Headers(),
              )
            : undefined,
      },
    })
    const { id } = store.createConversation({ temporary: true })
    await drain(chat.runTurn(id, { text: 'q' }))
    await drain(chat.runTurn(id, { text: 'q2' }))
    // Rejected, retried without, and later requests skip the failing attempt.
    expect(calls.map((c) => Boolean(c.params.include))).toEqual([
      true,
      false,
      false,
    ])
    expect(store.getPath(id)).toHaveLength(4)
  })
})
