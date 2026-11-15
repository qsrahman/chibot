import { describe, expect, it } from 'vitest'
import { describeUsedMemory } from '../../../src/web/chat/usedMemory.ts'

describe('describeUsedMemory', () => {
  it('has no chip without memories', () => {
    expect(describeUsedMemory([])).toBeNull()
  })

  it('counts them and says they were in context, not that they were used', () => {
    expect(describeUsedMemory([{ id: 1, text: 'a' }])).toEqual({
      short: 'Memory · 1',
      label: '1 saved memory was in context for this answer. Open memories',
    })
    expect(
      describeUsedMemory(Array(3).fill({ id: 1, text: 'a' })),
    ).toMatchObject({
      short: 'Memory · 3',
      label: expect.stringContaining('3 saved memories were in context'),
    })
  })
})
