// Models write a little HTML where Markdown has no way to say it, most often
// inside a table cell: `<br>` for a line break, and `<ul><li>…</li></ul>` (or
// `<ol>`) for a list. Raw HTML is never rendered (a page's text could carry
// anything), so these few tags are turned into what they mean before
// rendering: line breaks, and "• item" or "1. item" lines. Any other tag is
// left as it was, to be shown as text.

interface Node {
  type: string
  value?: string
  children?: Node[]
}

const BREAK = /^<br\s*\/?>$/i
const LIST_OPEN = /^<(ul|ol)(?:\s[^>]*)?>$/i
const LIST_CLOSE = /^<\/(?:ul|ol)>$/i
const ITEM_OPEN = /^<li(?:\s[^>]*)?>$/i
const ITEM_CLOSE = /^<\/li>$/i

// Where inline content lives (lists are only read there, not among blocks).
const INLINE_PARENTS = new Set([
  'paragraph',
  'tableCell',
  'heading',
  'emphasis',
  'strong',
  'delete',
  'link',
])

/** One run of inline content: `<br>`s and lists turned into breaks and text. */
function inline(children: Node[], listsRead: boolean): Node[] {
  const out: Node[] = []
  // The lists open, innermost last: whether each is numbered, and its count.
  const lists: { ordered: boolean; count: number }[] = []
  // A new line is due before the next thing (after an item or a list).
  let due = false
  const line = () => {
    if (out.length > 0 && out.at(-1)!.type !== 'break') {
      out.push({ type: 'break' })
    }
    due = false
  }
  for (const child of children) {
    const tag = child.type === 'html' ? (child.value?.trim() ?? '') : ''
    const list = listsRead ? LIST_OPEN.exec(tag) : null
    if (BREAK.test(tag)) {
      out.push({ type: 'break' })
      due = false
    } else if (list) {
      line()
      lists.push({ ordered: list[1]!.toLowerCase() === 'ol', count: 0 })
    } else if (listsRead && LIST_CLOSE.test(tag)) {
      lists.pop()
      due = true
    } else if (listsRead && ITEM_OPEN.test(tag)) {
      const current = lists.at(-1)
      if (current) current.count++
      if (due || out.length > 0) line()
      const indent = '  '.repeat(Math.max(0, lists.length - 1))
      const mark = current?.ordered ? `${current.count}. ` : '• '
      out.push({ type: 'text', value: indent + mark })
    } else if (listsRead && ITEM_CLOSE.test(tag)) {
      due = true
    } else {
      if (due) line()
      out.push(child)
    }
  }
  return out
}

function turn(node: Node): void {
  if (!node.children) return
  node.children.forEach(turn)
  node.children = inline(node.children, INLINE_PARENTS.has(node.type))
}

/** A remark plugin: `<br>` and simple `<ul>`/`<ol>` lists become breaks and lines. */
export function remarkHtmlBreaks() {
  return (tree: Node) => turn(tree)
}
