import { describe, expect, it } from 'vitest'
import { remarkHtmlBreaks } from '../../../src/web/chat/htmlBreaks.ts'

type Node = { type: string; value?: string; children?: Node[] }
const run = (tree: Node) => {
  remarkHtmlBreaks()(tree)
  return tree
}
const html = (value: string): Node => ({ type: 'html', value })
const text = (value: string): Node => ({ type: 'text', value })

describe('remarkHtmlBreaks', () => {
  it('turns <br> in any spelling into a line break, also deep in a table', () => {
    const cell: Node = {
      type: 'tableCell',
      children: [
        text('a'),
        html('<br>'),
        text('b'),
        html('<BR/>'),
        html('<br />'),
      ],
    }
    const tree = run({
      type: 'root',
      children: [
        { type: 'table', children: [{ type: 'tableRow', children: [cell] }] },
      ],
    })
    expect(cell.children!.map((n) => n.type)).toEqual([
      'text',
      'break',
      'text',
      'break',
      'break',
    ])
    expect(tree.children).toHaveLength(1)
  })

  it('leaves any other HTML alone, to be shown as text', () => {
    const paragraph: Node = {
      type: 'paragraph',
      children: [
        html('<img src=x onerror=alert(1)>'),
        html('<br>x'),
        html('<b>'),
      ],
    }
    run({ type: 'root', children: [paragraph] })
    expect(paragraph.children!.map((n) => n.type)).toEqual([
      'html',
      'html',
      'html',
    ])
  })
})

describe('remarkHtmlBreaks, lists', () => {
  const cellOf = (...children: Node[]) => {
    const cell: Node = { type: 'tableCell', children }
    run({
      type: 'root',
      children: [
        { type: 'table', children: [{ type: 'tableRow', children: [cell] }] },
      ],
    })
    return cell.children!.map((n) => (n.type === 'break' ? '\n' : n.value))
  }

  it('turns <ul><li> in a table cell into bullet lines, as models write them', () => {
    expect(
      cellOf(
        html('<ul>'),
        html('<li>'),
        text('Led the war.'),
        html('</li>'),
        html('<li>'),
        text('Founded the republic.'),
        html('</li>'),
        html('</ul>'),
      ),
    ).toEqual(['• ', 'Led the war.', '\n', '• ', 'Founded the republic.'])
  })

  it('numbers an <ol>, and keeps the text around a list on lines of its own', () => {
    expect(
      cellOf(
        text('Steps:'),
        html('<ol>'),
        html('<li>'),
        text('one'),
        html('</li>'),
        html('<li>'),
        text('two'),
        html('</li>'),
        html('</ol>'),
        text('Done.'),
      ),
    ).toEqual(['Steps:', '\n', '1. ', 'one', '\n', '2. ', 'two', '\n', 'Done.'])
  })

  it('indents a list inside a list, and takes attributes and any case', () => {
    expect(
      cellOf(
        html('<UL class="a">'),
        html('<li>'),
        text('outer'),
        html('<ul>'),
        html('<LI>'),
        text('inner'),
        html('</LI>'),
        html('</ul>'),
        html('</li>'),
        html('</UL>'),
      ),
    ).toEqual(['• ', 'outer', '\n', '\u00a0\u00a0• ', 'inner'])
  })

  it('leaves list tags alone outside inline text, and other tags as they were', () => {
    const root: Node = {
      type: 'root',
      children: [html('<ul>'), html('<li>'), html('<b>')],
    }
    run(root)
    expect(root.children!.map((n) => n.value)).toEqual(['<ul>', '<li>', '<b>'])
    expect(
      cellOf(html('<li>'), text('a'), html('<script>'), html('</li>')),
    ).toEqual(['• ', 'a', '<script>'])
  })
})
