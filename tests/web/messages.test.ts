import { describe, expect, it } from 'vitest'
import type { ResponseInputItem } from 'openai/resources/responses/responses'
import type { StoredItem } from '../../src/shared/types.ts'
import { toChatMessages } from '../../src/web/messages.ts'

const stored = (id: number, data: unknown): StoredItem => ({
  id,
  parentId: id - 1 || null,
  data: data as ResponseInputItem,
  usage: null,
  createdAt: 0,
})

describe('toChatMessages', () => {
  it('shows user and assistant messages, skipping other items', () => {
    const items = [
      stored(1, { role: 'user', content: 'Hi' }),
      stored(2, { type: 'reasoning', id: 'rs_1', summary: [] }),
      stored(3, {
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'Hello ', annotations: [] },
          { type: 'output_text', text: 'there', annotations: [] },
        ],
      }),
      stored(4, { role: 'assistant', content: 'partial' }),
      stored(5, { role: 'developer', content: 'hidden' }),
    ]
    expect(toChatMessages(items)).toEqual([
      { key: '1', role: 'user', text: 'Hi' },
      { key: '3', role: 'assistant', text: 'Hello there' },
      { key: '4', role: 'assistant', text: 'partial' },
    ])
  })

  it('shows refusals', () => {
    const items = [
      stored(1, {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'refusal', refusal: 'I can’t help with that.' }],
      }),
    ]
    expect(toChatMessages(items)[0]!.text).toBe('I can’t help with that.')
  })
})
