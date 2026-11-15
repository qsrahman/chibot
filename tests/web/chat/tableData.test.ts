import { describe, expect, it } from 'vitest'
import type { ExtraProps } from 'react-markdown'
import { delimited, tableRows } from '../../../src/web/chat/tableData.ts'

type Node = NonNullable<ExtraProps['node']>
const el = (tagName: string, children: unknown[] = []) =>
  ({ type: 'element', tagName, properties: {}, children }) as unknown as Node
const text = (value: string) => ({ type: 'text', value })
const cell = (tag: string, ...children: unknown[]) => el(tag, children)
const row = (tag: string, ...cells: unknown[][]) =>
  el(
    'tr',
    cells.map((c) => cell(tag, ...c)),
  )

const table = el('table', [
  el('thead', [row('th', [text('Name')], [text('Notes')])]),
  el('tbody', [
    row('td', [text('say "hi"')], [text('a'), el('br'), text(' b ')]),
    row('td', [text('x, y')], [text(' padded ')]),
  ]),
])

describe('tableRows', () => {
  it('reads the header and body rows, with <br> as a newline', () => {
    expect(tableRows(table)).toEqual([
      ['Name', 'Notes'],
      ['say "hi"', 'a\nb'],
      ['x, y', 'padded'],
    ])
  })
})

describe('delimited', () => {
  const rows = tableRows(table)
  it('quotes cells with quotes, newlines or the delimiter, for CSV', () => {
    expect(delimited(rows, ',')).toBe(
      'Name,Notes\n"say ""hi""","a\nb"\n"x, y",padded',
    )
  })
  it('separates by tabs, quoting only what a tab or line break would split', () => {
    expect(delimited(rows, '\t')).toBe(
      'Name\tNotes\n"say ""hi"""\t"a\nb"\nx, y\tpadded',
    )
  })
})
