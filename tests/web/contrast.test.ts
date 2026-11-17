import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The colour tokens (src/web/styles/base.css) in each theme, against
// WCAG 2: 4.5:1 for text, 3:1 for the edge of a control and other parts of
// the interface. Tokens with transparency are left out.
const css = readFileSync(
  join(import.meta.dirname, '../../src/web/styles/base.css'),
  'utf8',
)
const HEX = '#[0-9a-fA-F]{6}'

type Scheme = 'light' | 'dark' | 'macchiato' | 'latte'
const SCHEMES: Scheme[] = ['light', 'dark', 'macchiato', 'latte']
/** `null` is the default blue; the others have blocks in base.css. */
const ACCENTS = [null, 'violet', 'teal', 'green', 'orange', 'pink']

/** The declarations of the rule that starts with `selector`. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) return ''
  return css.slice(start, css.indexOf('\n}', start))
}

// The default tokens are light-dark() pairs in :root; the Macchiato and Latte
// blocks override the ones they name (as plain colours); an accent's blocks
// override the accent's.
const ROOT = block(':root')
const OWN = (scheme: Scheme) => block(`:root[data-theme='${scheme}']`)

function value(
  source: string,
  name: string,
  scheme: Scheme,
): string | undefined {
  const pair = new RegExp(
    `--${name}:\\s*light-dark\\(\\s*(${HEX})\\s*,\\s*(${HEX})\\s*\\)`,
  ).exec(source)
  if (pair) return pair[scheme === 'light' || scheme === 'latte' ? 1 : 2]
  return new RegExp(`--${name}:\\s*(${HEX})\\s*;`).exec(source)?.[1]
}

function token(
  name: string,
  scheme: Scheme,
  accent: string | null = null,
): string {
  if (name.startsWith('#')) return name // a colour written in the CSS itself
  if (accent) {
    const selector =
      scheme === 'macchiato' || scheme === 'latte'
        ? `:root[data-theme='${scheme}'][data-accent='${accent}']`
        : `:root[data-accent='${accent}']`
    const own = value(block(selector), name, scheme)
    if (own) return own
  }
  const found =
    ((scheme === 'macchiato' || scheme === 'latte') &&
      value(OWN(scheme), name, scheme)) ||
    value(ROOT, name, scheme)
  if (found) return found
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
  // The message box's hint is drawn on its card (--surface).
  ['fg-placeholder', 'surface'],
  ...['bg', 'surface'].map((bg): [string, string] => ['danger', bg]),
  ['bubble-fg', 'bubble-bg'],
  ['danger-fg', 'danger'],
  // Code sits on the page, and on a card if it is shown in one.
  ...CODE.flatMap((fg) =>
    ['bg', 'surface', 'surface-muted'].map((bg): [string, string] => [fg, bg]),
  ),
  // Find in chat: the matches and the current one.
  ['find-fg', 'find-bg'],
  ['find-fg', 'find-current-bg'],
  ['code-added', 'code-added-bg'],
  ['code-removed', 'code-removed-bg'],
]
const INTERFACE: [string, string][] = [
  // The edge of a field is what shows where it is.
  ['border-control', 'bg'],
  ['border-control', 'surface'],
  // A switch's thumb on its track when it is off (settings.css).
  ['switch-thumb', 'switch-track'],
]

/** The pairs that depend on the accent, checked for each accent. */
const ACCENT_TEXT: [string, string, number][] = [
  ['accent-fg', 'accent', 4.5],
  // A citation chip, on its tint and on the card it opens.
  ['cite-fg', 'cite-bg', 4.5],
  ['cite-fg', 'surface-raised', 4.5],
  ['accent-tile-fg', 'accent-tile', 4.5],
]
const ACCENT_INTERFACE: [string, string][] = [
  ['accent', 'bg'],
  ['accent', 'surface'],
  // A switch's thumb on its track when it is on.
  ['switch-thumb-on', 'accent'],
]

describe.each(SCHEMES)('colour tokens, %s', (scheme) => {
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

describe.each(SCHEMES)('accent colours, %s', (scheme) => {
  describe.each(ACCENTS)('%s', (accent) => {
    it('has its own colours', () => {
      const own = token('accent', scheme, accent) !== token('accent', scheme)
      expect(own).toBe(accent !== null)
    })

    it.each(ACCENT_TEXT)('%s on %s is readable (%s:1)', (fg, bg, ratio) => {
      expect(
        contrast(token(fg, scheme, accent), token(bg, scheme, accent)),
      ).toBeGreaterThanOrEqual(ratio)
    })

    it.each(ACCENT_INTERFACE)('%s on %s shows (3:1)', (fg, bg) => {
      expect(
        contrast(token(fg, scheme, accent), token(bg, scheme, accent)),
      ).toBeGreaterThanOrEqual(3)
    })
  })
})
