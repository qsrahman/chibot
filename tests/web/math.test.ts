import { describe, expect, it } from 'vitest'
import { dollarMath } from '../../src/web/math.ts'

describe('dollarMath', () => {
  it('turns \\( \\) into inline math', () => {
    expect(dollarMath('Area is \\(\\pi r^2\\) here.')).toBe(
      'Area is $\\pi r^2$ here.',
    )
  })

  it('turns \\[ \\] into display math on its own lines', () => {
    expect(dollarMath('So:\\[\na^2 + b^2 = c^2\n\\]done')).toBe(
      'So:\n$$\na^2 + b^2 = c^2\n$$\ndone',
    )
  })

  it('leaves code alone', () => {
    const fenced = '```latex\n\\(x\\) and \\[y\\]\n```'
    expect(dollarMath(fenced)).toBe(fenced)
    expect(dollarMath('Type `\\(x\\)` for \\(x\\)')).toBe(
      'Type `\\(x\\)` for $x$',
    )
  })

  it('leaves unclosed delimiters (and text mid-stream) alone', () => {
    expect(dollarMath('a \\( b')).toBe('a \\( b')
    expect(dollarMath('so \\[ x + 1')).toBe('so \\[ x + 1')
  })

  it('keeps text that already uses dollars', () => {
    expect(dollarMath('$x$ and $$y$$')).toBe('$x$ and $$y$$')
  })
})
