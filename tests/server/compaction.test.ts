import { describe, expect, it } from 'vitest'
import type { ResponseInputItem } from 'openai/resources/responses/responses'
import {
  ChatService,
  fromLastCompaction,
} from '../../src/server/chat-service.ts'
import {
  answerEvents,
  drain,
  fakeClient,
  memoryStore,
  testSettings,
  type FakeCall,
  testChat,
} from './fakes.ts'

const compaction = (id: string) =>
  ({ type: 'compaction', id, encrypted_content: 'x' }) as ResponseInputItem
const user = (content: string) => ({ role: 'user' as const, content })

describe('compaction', () => {
  it('starts the input at the last compaction item', () => {
    const items = [
      user('a'),
      compaction('c1'),
      user('b'),
      compaction('c2'),
      user('c'),
    ]
    expect(fromLastCompaction(items)).toEqual([compaction('c2'), user('c')])
    expect(fromLastCompaction([user('a')])).toEqual([user('a')])
  })

  it('asks for compaction at the threshold, or not at all when off', async () => {
    const options = async (overrides = {}) => {
      const calls: FakeCall[] = []
      const store = memoryStore()
      const chat = testChat(answerEvents('a'), {
        store,
        calls,
        settings: testSettings('m', overrides),
      })
      await drain(
        chat.runTurn(store.createConversation({ temporary: true }).id, {
          text: 'q',
        }),
      )
      return calls[0]!.params.context_management
    }
    expect(await options()).toEqual([
      { type: 'compaction', compact_threshold: 64_000 },
    ])
    expect(await options({ compactThreshold: null })).toBeUndefined()
  })

  it('sends only what follows the compaction on the next turn', async () => {
    const calls: FakeCall[] = []
    const compacted = answerEvents('first answer')
    const done = compacted.at(-1) as unknown as {
      response: { output: ResponseInputItem[] }
    }
    done.response.output = [compaction('c1'), ...done.response.output]
    const store = memoryStore()
    // The first turn compacts; later turns answer normally.
    const client = fakeClient(
      (call) => (call === 0 ? compacted : answerEvents('second')),
      calls,
    )
    const chat = new ChatService(client, store, testSettings())
    const { id } = store.createConversation({ temporary: true })

    await drain(chat.runTurn(id, { text: 'early question' }))
    await drain(chat.runTurn(id, { text: 'next question' }))

    expect(calls[1]!.params.input).toEqual([
      compaction('c1'),
      expect.objectContaining({ type: 'message', role: 'assistant' }),
      user('next question'),
    ])
  })
})
