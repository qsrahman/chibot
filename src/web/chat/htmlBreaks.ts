// Models write `<br>` to break a line inside a table cell, which Markdown has
// no other way to do. Raw HTML is never rendered (a page's text could carry
// anything), so this one tag is turned into a line break before rendering.

interface Node {
  type: string
  value?: string
  children?: Node[]
}

const BREAK = /^<br\s*\/?>$/i

function turn(node: Node): void {
  if (!node.children) return
  node.children = node.children.map((child) => {
    if (child.type === 'html' && BREAK.test(child.value?.trim() ?? '')) {
      return { type: 'break' }
    }
    turn(child)
    return child
  })
}

/** A remark plugin: `<br>`, `<br/>` and `<br />` become line breaks. */
export function remarkHtmlBreaks() {
  return (tree: Node) => turn(tree)
}
