import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConversationStore } from '../../src/server/conversation-store.ts'
import { usage } from './fakes.ts'

describe('ConversationStore versions', () => {
  let store: ConversationStore
  let id: string
  beforeEach(() => {
    store = new ConversationStore(':memory:')
    id = store.createConversation().id
  })
  afterEach(() => store.close())

  const user = (parent: number | null, content: string) =>
    store.appendItems(id, parent, [{ role: 'user', content }])[0]!
  const answer = (parent: number, content: string) =>
    store.appendItems(id, parent, [{ role: 'assistant', content }], usage)[0]!
  const texts = () =>
    store.getPath(id).map((i) => ('content' in i.data ? i.data.content : ''))

  it('reports siblings for edits and regenerations', () => {
    const q1 = user(null, 'q1')
    const a1 = answer(q1.id, 'a1')
    const a2 = answer(q1.id, 'a2') // regenerated
    const q1b = user(null, 'q1 edited') // edit of q1

    expect(a2.siblingIds).toEqual([a1.id, a2.id])
    expect(q1b.siblingIds).toEqual([q1.id, q1b.id])

    store.switchToVersion(id, q1.id)
    expect(store.getPath(id).map((i) => i.siblingIds)).toEqual([
      [q1.id, q1b.id],
      [a1.id, a2.id],
    ])
  })

  it('switches to the newest leaf below a version, keeping follow-ups', () => {
    const q1 = user(null, 'q1')
    const a1 = answer(q1.id, 'a1')
    const q2 = user(a1.id, 'q2 on a1')
    answer(q2.id, 'a2 on a1')
    const b1 = answer(q1.id, 'b1') // regenerate q1's answer
    expect(texts()).toEqual(['q1', 'b1'])

    expect(store.switchToVersion(id, a1.id)).toBe(true)
    expect(texts()).toEqual(['q1', 'a1', 'q2 on a1', 'a2 on a1'])

    expect(store.switchToVersion(id, b1.id)).toBe(true)
    expect(texts()).toEqual(['q1', 'b1'])
  })

  it('rejects items from other conversations', () => {
    const other = store.createConversation().id
    const foreign = store.appendItems(other, null, [
      { role: 'user', content: 'x' },
    ])[0]!
    expect(store.switchToVersion(id, foreign.id)).toBe(false)
    expect(store.getItem(id, foreign.id)).toBeUndefined()
    expect(store.getPath(id, foreign.id)).toEqual([])
  })

  it('reads the path to any item', () => {
    const q1 = user(null, 'q1')
    const a1 = answer(q1.id, 'a1')
    user(a1.id, 'q2')
    expect(store.getPath(id, a1.id).map((i) => i.id)).toEqual([q1.id, a1.id])
    expect(store.getItem(id, a1.id)).toMatchObject({ id: a1.id, usage })
  })

  it('totals usage across all versions', () => {
    const q1 = user(null, 'q1')
    answer(q1.id, 'a1')
    answer(q1.id, 'a2')
    expect(store.getUsageTotals(id)).toMatchObject({
      input_tokens: 2 * usage.input_tokens,
      output_tokens: 2 * usage.output_tokens,
      total_tokens: 2 * usage.total_tokens,
    })
  })
})
