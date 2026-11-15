import { describe, expect, it } from 'vitest'
import {
  shownSuggestions,
  suggestionTarget,
} from '../../../src/web/chat/followUps.ts'
import type { Turn } from '../../../src/web/chat/turns.ts'

const turn = (answer: Partial<NonNullable<Turn['answer']>> | null) =>
  ({
    key: 'k',
    question: {},
    answer: answer && { itemId: 5, incomplete: false, ...answer },
  }) as unknown as Turn

describe('suggestionTarget', () => {
  it('is the newest saved, finished answer', () => {
    expect(
      suggestionTarget([turn({ itemId: 3 }), turn({ itemId: 5 })], 0),
    ).toBe(5)
  })

  it('is none without a finished, saved answer, or while a tool call waits', () => {
    expect(suggestionTarget([], 0)).toBeNull()
    expect(suggestionTarget([turn(null)], 0)).toBeNull()
    expect(suggestionTarget([turn({ incomplete: true })], 0)).toBeNull()
    expect(suggestionTarget([turn({ itemId: null })], 0)).toBeNull()
    expect(suggestionTarget([turn({})], 1)).toBeNull()
  })
})

describe('shownSuggestions', () => {
  const found = { chatId: 'c', itemId: 5, suggestions: ['A', 'B'] }

  it('shows them for the newest answer of the chat once idle', () => {
    expect(shownSuggestions(found, 'c', 5, true)).toEqual(['A', 'B'])
  })

  it('hides them while busy or queued, for another answer or another chat', () => {
    expect(shownSuggestions(found, 'c', 5, false)).toEqual([])
    expect(shownSuggestions(found, 'c', 6, true)).toEqual([])
    expect(shownSuggestions(found, 'd', 5, true)).toEqual([])
    expect(shownSuggestions(null, 'c', 5, true)).toEqual([])
  })
})
