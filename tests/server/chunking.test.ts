import { describe, expect, it } from 'vitest'
import { chunkStyle, chunkText } from '../../src/server/chunking.ts'

describe('chunkStyle', () => {
  it('splits markdown by section and source by unit, the rest as prose', () => {
    expect(chunkStyle('Notes.MD')).toBe('markdown')
    expect(chunkStyle('src/app.ts')).toBe('code')
    expect(chunkStyle('data.csv')).toBe('prose')
    expect(chunkStyle('Dockerfile')).toBe('prose')
  })
})

describe('chunkText', () => {
  it('keeps short text whole', () => {
    expect(chunkText('One.\n\nTwo.')).toEqual(['One.\n\nTwo.'])
  })

  it('splits at paragraph breaks, overlapping by whole paragraphs', () => {
    const paragraphs = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]
    expect(
      chunkText(paragraphs.join('\n\n'), { size: 90, overlap: 45 }),
    ).toEqual([
      `${'a'.repeat(40)}\n\n${'b'.repeat(40)}`,
      `${'b'.repeat(40)}\n\n${'c'.repeat(40)}`,
    ])
  })

  it('cuts paragraphs longer than a chunk at spaces', () => {
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')
    const chunks = chunkText(words, { size: 50, overlap: 10 })
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.every((c) => c.length <= 50)).toBe(true)
    expect(chunks.join(' ')).toContain('w59')
  })

  it('cuts a long paragraph at sentence ends, overlapping by a sentence', () => {
    const sentence = (n: number) => `This is sentence number ${n} of many.`
    const text = Array.from({ length: 20 }, (_, i) => sentence(i + 1)).join(' ')
    const chunks = chunkText(text, { size: 120, overlap: 50 })
    expect(chunks.length).toBeGreaterThan(3)
    for (const chunk of chunks) {
      expect(chunk).toMatch(/^This is sentence/)
      expect(chunk).toMatch(/of many\.$/)
    }
    // Each chunk starts with something the one before ended with.
    for (const [i, chunk] of chunks.slice(1).entries()) {
      const first = chunk.split('.')[0]!
      expect(chunks[i]).toContain(first)
    }
  })

  it('cuts long unbroken lines (data) at line breaks', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `row${i},value${i}`)
    const chunks = chunkText(rows.join('\n'), { size: 100, overlap: 20 })
    expect(chunks.length).toBeGreaterThan(3)
    for (const chunk of chunks) {
      expect(chunk).toMatch(/^row\d+,value\d+/)
      expect(chunk).toMatch(/value\d+$/)
    }
  })

  it('splits long text without blank lines in linear time', () => {
    const text = 'word '.repeat(400_000)
    const start = performance.now()
    expect(chunkText(text).length).toBeGreaterThan(500)
    expect(performance.now() - start).toBeLessThan(5000)
  })

  describe('markdown', () => {
    const doc = (heading: string, words: number) =>
      `${heading}\n\n${'word '.repeat(words).trim()}`

    it('starts a new chunk at a section, without overlap, naming the sections above', () => {
      const text = [
        doc('# Guide', 20),
        doc('## Install', 20),
        doc('### Linux', 20),
        doc('## Usage', 20),
      ].join('\n\n')
      const chunks = chunkText(text, {
        style: 'markdown',
        size: 1000,
        overlap: 100,
      })
      // A section only starts a chunk once the current one has some substance.
      expect(chunks.map((c) => c.split('\n')[0])).toEqual([
        '# Guide',
        '[Guide]',
      ])
      expect(chunks[0]).toContain('### Linux')
      expect(chunks[1]).toMatch(/^\[Guide\]\n## Usage/)

      // Cut inside a section: the chunk says where it is.
      const small = chunkText(text, {
        style: 'markdown',
        size: 150,
        overlap: 0,
      })
      expect(
        small.some((c) => c.startsWith('[Guide > Install > Linux]\nword')),
      ).toBe(true)
    })

    it('says which sections a chunk from the middle of one is under', () => {
      const body = Array.from(
        { length: 12 },
        (_, i) => `Paragraph ${i}. ` + 'x'.repeat(60),
      )
      const text = `# Guide\n\n## Install\n\n${body.join('\n\n')}`
      const chunks = chunkText(text, {
        style: 'markdown',
        size: 300,
        overlap: 0,
      })
      expect(chunks.length).toBeGreaterThan(2)
      expect(chunks[0]).toMatch(/^# Guide\n\n## Install\n\nParagraph 0/)
      expect(chunks[1]).toMatch(/^\[Guide > Install\]\nParagraph/)
    })

    it('keeps fenced code whole, and its # comments are not headings', () => {
      const code = '```py\n# not a heading\n\nprint(1)\n```'
      const chunks = chunkText(`# A\n\n${code}\n\ntext`, { style: 'markdown' })
      expect(chunks).toEqual([`# A\n\n${code}\n\ntext`])
    })
  })

  describe('code', () => {
    const fn = (name: string) =>
      `export function ${name}() {\n  const a = 1\n\n  return a\n}`

    it('keeps a function together, blank lines inside it and all', () => {
      const text = [
        'import x from "x"',
        fn('one'),
        fn('two'),
        fn('three'),
      ].join('\n\n')
      const chunks = chunkText(text, { style: 'code', size: 60, overlap: 0 })
      expect(chunks).toEqual([
        'import x from "x"',
        fn('one'),
        fn('two'),
        fn('three'),
      ])
    })

    it('starts a unit after a closing brace even without a blank line', () => {
      const text = `${fn('one')}\n${fn('two')}`
      expect(chunkText(text, { style: 'code', size: 70, overlap: 0 })).toEqual([
        fn('one'),
        fn('two'),
      ])
    })

    it('keeps a comment and decorator with what they describe', () => {
      const text = `# Adds.\n@cache\ndef add(a, b):\n    return a + b\n\n# Subtracts.\ndef sub(a, b):\n    return a - b`
      const chunks = chunkText(text, { style: 'code', size: 60, overlap: 0 })
      expect(chunks).toEqual([
        '# Adds.\n@cache\ndef add(a, b):\n    return a + b',
        '# Subtracts.\ndef sub(a, b):\n    return a - b',
      ])
    })

    it('cuts a class too long for a chunk between its methods', () => {
      const method = (n: number) => `    def m${n}(self):\n        return ${n}`
      const text = `class A:\n${Array.from({ length: 8 }, (_, i) => method(i)).join('\n\n')}`
      const chunks = chunkText(text, { style: 'code', size: 100, overlap: 0 })
      expect(chunks.length).toBeGreaterThan(2)
      for (const chunk of chunks.slice(1)) expect(chunk).toMatch(/^ {4}def m\d/)
    })
  })
})
