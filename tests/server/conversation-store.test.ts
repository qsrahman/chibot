import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ResponseUsage } from 'openai/resources/responses/responses'
import { ConversationStore } from '../../src/server/conversation-store.ts'

const usage = {
  input_tokens: 10,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: 5,
  output_tokens_details: { reasoning_tokens: 2 },
  total_tokens: 15,
} as ResponseUsage

describe('ConversationStore', () => {
  let store: ConversationStore
  beforeEach(() => {
    store = new ConversationStore(':memory:')
  })
  afterEach(() => store.close())

  it('creates and fetches a conversation', () => {
    const created = store.createConversation()
    expect(created).toMatchObject({ title: null, currentLeafId: null })
    expect(store.getConversation(created.id)).toEqual(created)
    expect(store.getConversation('missing')).toBeUndefined()
  })

  it('starts with an empty path', () => {
    const { id } = store.createConversation()
    expect(store.getPath(id)).toEqual([])
  })

  it('appends items as a chain and moves the leaf', () => {
    const { id } = store.createConversation()
    const [user] = store.appendItems(id, null, [
      { role: 'user', content: 'hi' },
    ])
    const answer = store.appendItems(
      id,
      user!.id,
      [
        { role: 'assistant', content: 'thinking' },
        { role: 'assistant', content: 'hello' },
      ],
      usage,
    )

    expect(answer.map((i) => i.parentId)).toEqual([user!.id, answer[0]!.id])
    expect(answer.map((i) => i.usage)).toEqual([null, usage])
    expect(store.getConversation(id)!.currentLeafId).toBe(answer[1]!.id)

    const path = store.getPath(id)
    expect(path.map((i) => i.data)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'thinking' },
      { role: 'assistant', content: 'hello' },
    ])
    expect(path).toEqual([user, ...answer])
  })

  it('follows only the current branch', () => {
    const { id } = store.createConversation()
    const [root] = store.appendItems(id, null, [{ role: 'user', content: 'q' }])
    store.appendItems(id, root!.id, [{ role: 'assistant', content: 'old' }])
    store.appendItems(id, root!.id, [{ role: 'assistant', content: 'new' }])

    expect(store.getPath(id).map((i) => i.data)).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'new' },
    ])
  })

  it('keeps conversations apart', () => {
    const a = store.createConversation()
    const b = store.createConversation()
    store.appendItems(a.id, null, [{ role: 'user', content: 'a' }])
    expect(store.getPath(b.id)).toEqual([])
  })

  it('persists across reopening a file', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'chibot-'))
    try {
      const file = join(dir, 'test.db')
      const first = new ConversationStore(file)
      const { id } = first.createConversation()
      first.appendItems(id, null, [{ role: 'user', content: 'kept' }])
      first.close()

      const second = new ConversationStore(file)
      expect(second.getPath(id).map((i) => i.data)).toEqual([
        { role: 'user', content: 'kept' },
      ])
      second.close()
    } finally {
      rmSync(dir, { recursive: true })
    }
  })
})
