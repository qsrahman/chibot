import { toText } from 'hast-util-to-text'
import type { ExtraProps } from 'react-markdown'

type Element = NonNullable<ExtraProps['node']>

/** A table's rows as text (header row first). A `<br>` in a cell is a newline. */
export function tableRows(table: Element): string[][] {
  const rows: string[][] = []
  const visit = (node: Element) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue
      if (child.tagName === 'tr') {
        rows.push(
          child.children
            .filter((c) => c.type === 'element')
            .map((cell) =>
              toText(cell)
                .split('\n')
                .map((line) => line.trim())
                .join('\n')
                .trim(),
            ),
        )
      } else visit(child)
    }
  }
  visit(table)
  return rows
}

/**
 * Rows as delimited text. A cell with the delimiter, a quote or a line break
 * is quoted (quotes doubled), which spreadsheets read back as one cell.
 */
export function delimited(rows: string[][], delimiter: '\t' | ','): string {
  const cell = (text: string) =>
    text.includes(delimiter) || /["\r\n]/.test(text)
      ? `"${text.replaceAll('"', '""')}"`
      : text
  return rows.map((row) => row.map(cell).join(delimiter)).join('\n')
}
