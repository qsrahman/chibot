import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The colour tokens (src/web/styles/base.css) in both colour schemes, against
// WCAG 2: 4.5:1 for text, 3:1 for the edge of a control and other parts of
// the interface. Tokens with transparency are left out.
const css = readFileSync(
  join(import.meta.dirname, '../../src/web/styles/base.css'),
  'utf8',
)
const HEX = '#[0-9a-fA-F]{6}'

function token(name: string, scheme: 'light' | 'dark'): string {
  if (name.startsWith('#')) return name // a colour written in the CSS itself
  const pair = new RegExp(
    `--${name}:\\s*light-dark\\(\\s*(${HEX})\\s*,\\s*(${HEX})\\s*\\)`,
  ).exec(css)
  if (pair) return pair[scheme === 'light' ? 1 : 2]!
  const plain = new RegExp(`--${name}:\\s*(${HEX})\\s*;`).exec(css)
  if (plain) return plain[1]!
  throw new Error(`no opaque colour token --${name}`)
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const CODE = [
  'keyword',
  'title',
  'number',
  'string',
  'builtin',
  'comment',
  'name',
].map((name) => `code-${name}`)

/** [foreground, background] pairs that must reach a ratio. */
const TEXT: [string, string][] = [
  // Menus, toasts and the citation card are drawn on surface-raised.
  ...['bg', 'surface', 'surface-muted', 'surface-raised'].map(
    (bg): [string, string] => ['fg', bg],
  ),
  ...['bg', 'surface', 'surface-muted', 'surface-raised', 'chip'].map(
    (bg): [string, string] => ['fg-muted', bg],
  ),
  ...['bg', 'surface'].map((bg): [string, string] => ['danger', bg]),
  ['bubble-fg', 'bubble-bg'],
  ['danger-fg', 'danger'],
  // Code sits on the page, and on a card if it is shown in one.
  ...CODE.flatMap((fg) =>
    ['bg', 'surface', 'surface-muted'].map((bg): [string, string] => [fg, bg]),
  ),
  ['code-added', 'code-added-bg'],
  ['code-removed', 'code-removed-bg'],
]
const INTERFACE: [string, string][] = [
  // The edge of a field is what shows where it is.
  ['border-control', 'bg'],
  ['border-control', 'surface'],
  ['accent', 'bg'],
  ['accent', 'surface'],
  // A switch's thumb is white (settings.css), on its track on and off.
  ['#ffffff', 'accent'],
]

describe.each(['light', 'dark'] as const)('colour tokens, %s', (scheme) => {
  it.each(TEXT)('%s on %s is readable (4.5:1)', (fg, bg) => {
    expect(
      contrast(token(fg, scheme), token(bg, scheme)),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it.each(INTERFACE)('%s on %s shows (3:1)', (fg, bg) => {
    expect(
      contrast(token(fg, scheme), token(bg, scheme)),
    ).toBeGreaterThanOrEqual(3)
  })
})
