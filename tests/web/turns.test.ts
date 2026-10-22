import { describe, expect, it } from 'vitest'
import type { ResponseInputItem } from 'openai/resources/responses/responses'
import type { StoredItem } from '../../src/shared/types.ts'
import { toTurns } from '../../src/web/turns.ts'
import { usage } from '../server/fakes.ts'

const item = (
  id: number,
  data: unknown,
  extra: Partial<StoredItem> = {},
): StoredItem => ({
  id,
  parentId: id - 1 || null,
  data: data as ResponseInputItem,
  usage: null,
  model: null,
  siblingIds: [id],
  createdAt: 0,
  ...extra,
})

describe('toTurns', () => {
  it('groups each question with the output items that answer it', () => {
    const turns = toTurns([
      item(1, { role: 'user', content: 'Hi' }),
      item(2, {
        type: 'reasoning',
        id: 'rs_1',
        summary: [
          { type: 'summary_text', text: '**Plan**' },
          { type: 'summary_text', text: 'Say hello.' },
        ],
      }),
      item(3, {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello ', annotations: [] }],
      }),
      item(4, { role: 'assistant', content: 'there' }, { usage, model: 'm-1' }),
      item(5, { role: 'user', content: 'Bye' }),
    ])
    expect(turns).toEqual([
      {
        key: '1',
        question: { itemId: 1, parentId: null, text: 'Hi', versions: null },
        // The answer is identified by its first item (where regenerations
        // branch off), and its text joins the message items.
        answer: {
          itemId: 2,
          text: 'Hello \n\nthere',
          thinking: '**Plan**\n\nSay hello.',
          usage,
          model: 'm-1',
          versions: null,
        },
        compacted: false,
      },
      {
        key: '5',
        question: { itemId: 5, parentId: 4, text: 'Bye', versions: null },
        answer: null,
        compacted: false,
      },
    ])
  })

  it('reports versions with a 1-based index', () => {
    const [turn] = toTurns([
      item(7, { role: 'user', content: 'edited' }, { siblingIds: [1, 7] }),
      item(9, { role: 'assistant', content: 'b' }, { siblingIds: [8, 9, 10] }),
    ])
    expect(turn!.question.versions).toEqual({ index: 2, ids: [1, 7] })
    expect(turn!.answer!.versions).toEqual({ index: 2, ids: [8, 9, 10] })
  })

  it('marks answers that compacted the context', () => {
    const [turn] = toTurns([
      item(1, { role: 'user', content: 'q' }),
      item(2, { type: 'compaction', id: 'c', encrypted_content: 'x' }),
      item(3, { role: 'assistant', content: 'a' }),
    ])
    expect(turn!.compacted).toBe(true)
    expect(turn!.answer!.text).toBe('a')
  })

  it('shows refusals as text', () => {
    const [turn] = toTurns([
      item(1, { role: 'user', content: 'q' }),
      item(2, {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'refusal', refusal: 'I can’t help with that.' }],
      }),
    ])
    expect(turn!.answer!.text).toBe('I can’t help with that.')
  })
})
