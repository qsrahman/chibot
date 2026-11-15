import { describe, expect, it } from 'vitest'
import {
  matchLabel,
  matchOffsets,
  stepMatch,
} from '../../../src/web/chat/find.ts'

describe('matchOffsets', () => {
  it('finds every occurrence, ignoring case', () => {
    expect(matchOffsets('Retry, retry, RETRY', 'retry')).toEqual([0, 7, 14])
  })

  it('does not overlap matches', () => {
    expect(matchOffsets('aaaa', 'aa')).toEqual([0, 2])
  })

  it('finds nothing for an empty query or a missing word', () => {
    expect(matchOffsets('hello', '')).toEqual([])
    expect(matchOffsets('hello', 'bye')).toEqual([])
  })

  it('treats the query as text, not a pattern', () => {
    expect(matchOffsets('a.b axb', 'a.b')).toEqual([0])
  })

  it('gives up where lower-casing changes the length', () => {
    expect(matchOffsets('İİ i', 'i')).toEqual([])
  })
})

describe('matchLabel and stepMatch', () => {
  it('counts from one, and says when nothing matches', () => {
    expect(matchLabel('a', 2, 12)).toBe('3 of 12')
    expect(matchLabel('a', 0, 0)).toBe('No matches')
    expect(matchLabel('', 0, 0)).toBe('')
  })

  it('steps round the ends', () => {
    expect(stepMatch(2, 3, false)).toBe(0)
    expect(stepMatch(0, 3, true)).toBe(2)
    expect(stepMatch(1, 3, false)).toBe(2)
    expect(stepMatch(0, 0, false)).toBe(0)
  })
})
