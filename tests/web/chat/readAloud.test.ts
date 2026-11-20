import { describe, expect, it } from 'vitest'
import {
  speakableText,
  speechChunks,
  speechLanguage,
} from '../../../src/web/chat/readAloud.ts'

describe('speakableText', () => {
  it('drops the marks and reads the words', () => {
    expect(
      speakableText(
        '## Title\n\nSome **bold**, _italic_ and `code` text.\n\n- one\n- two\n1. first',
      ),
    ).toBe('Title\n\nSome bold, italic and code text.\n\none\ntwo\nfirst')
  })

  it('leaves out code blocks, even one still being written', () => {
    expect(speakableText('Before\n\n```ts\nconst a = 1\n```\n\nAfter')).toBe(
      'Before\n\nAfter',
    )
    expect(speakableText('Before\n\n```ts\nconst a')).toBe('Before')
  })

  it('reads a link as its words, drops a citation number, an image and a tag', () => {
    expect(
      speakableText(
        'See [the docs](https://example.com) [1](https://a.test/) ![x](y.png) <b>now</b> <https://z.test>.',
      ),
    ).toBe('See the docs now .')
  })

  it('reads a table as its cells, without the divider row', () => {
    const spoken = speakableText('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(spoken).not.toContain('---')
    expect(spoken).toContain('A')
    expect(spoken).toContain('2')
  })

  it('has nothing for nothing', () => {
    expect(speakableText('```\nonly code\n```')).toBe('')
    expect(speakableText('')).toBe('')
  })
})

describe('speechChunks', () => {
  it('keeps sentences together up to a piece, and does not lose any text', () => {
    const text = Array.from(
      { length: 20 },
      (_, i) => `Sentence number ${i}.`,
    ).join(' ')
    const chunks = speechChunks(text, 80)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(80)
    expect(chunks.join(' ')).toBe(text)
  })

  it('splits a very long sentence at spaces', () => {
    const long = 'word '.repeat(200).trim()
    const chunks = speechChunks(long, 100)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long)
  })

  it('splits at Urdu and Arabic sentence marks too', () => {
    expect(speechChunks('یہ پہلا جملہ ہے۔ یہ دوسرا ہے؟ تیسرا', 12)).toEqual([
      'یہ پہلا جملہ ہے۔',
      'یہ دوسرا ہے؟',
      'تیسرا',
    ])
  })
})

describe('speechLanguage', () => {
  it('picks Urdu for Arabic script and leaves the rest to the browser', () => {
    expect(speechLanguage('یہ ایک جملہ ہے')).toBe('ur-PK')
    expect(speechLanguage('A plain sentence')).toBeUndefined()
  })
})
