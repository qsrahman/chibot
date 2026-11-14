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
