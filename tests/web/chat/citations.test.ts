import { describe, expect, it, vi } from 'vitest'
import {
  citedNumbers,
  isCitationLabel,
} from '../../../src/web/chat/citations.ts'
import { sourceHost } from '../../../src/web/chat/turns.ts'

const sources = [
  { url: 'https://a.test/x', title: 'A' },
  { url: 'https://b.test/y', title: 'B' },
  { url: '/c/abc', title: 'Chat', kind: 'chat' as const },
]

describe('isCitationLabel', () => {
  it('accepts a bare or bracketed number only', () => {
    expect(['1', '[2]', '12'].map(isCitationLabel)).toEqual([true, true, true])
    expect(
      ['', 'the guide', '1a', '[[1]]', '1234'].map(isCitationLabel),
    ).toEqual([false, false, false, false, false])
  })
})

describe('citedNumbers', () => {
  vi.stubGlobal('location', { origin: 'http://localhost:3000' })

  it('lists the sources cited by number, once each, by their place in the list', () => {
    const text =
      'One [1](https://b.test/y) and again [[2]](https://b.test/y#top), then [3](/c/abc) and [1](https://a.test/x).'
    expect(citedNumbers(text, sources)).toEqual([2, 3, 1])
  })

  it('ignores links to other pages, and links with words', () => {
    const text =
      '[1](https://elsewhere.test/) and [the guide](https://a.test/x) and plain [1].'
    expect(citedNumbers(text, sources)).toEqual([])
  })
})

describe('sourceHost', () => {
  it('names the site, or the kind of source', () => {
    expect(sourceHost(sources[0]!)).toBe('a.test')
    expect(sourceHost(sources[2]!)).toBe('Your chats')
    expect(sourceHost({ url: '/api/files/f', title: 'f', kind: 'file' })).toBe(
      'Project file',
    )
  })
})
