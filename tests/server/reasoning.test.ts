import { describe, expect, it } from 'vitest'
import { ChatService } from '../../src/server/chat-service.ts'
import {
  answerEvents,
  drain,
  fakeClient,
  memoryStore,
  testSettings,
  type FakeCall,
} from './fakes.ts'

describe('reasoning', () => {
  async function turns(
    settings: ReturnType<typeof testSettings>,
    options: { rejectReasoning?: boolean } = {},
    count = 1,
  ) {
    const calls: FakeCall[] = []
    const store = memoryStore()
    const chat = new ChatService(
      fakeClient(answerEvents('a'), calls, options),
      store,
      settings,
    )
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
})
