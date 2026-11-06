/** `selected` as a Markdown block quote, followed by a blank line to write under it. */
export function quoteText(selected: string): string {
  const lines = selected.trim().replace(/\r\n?/g, '\n').split('\n')
  return `${lines.map((line) => `> ${line}`.trimEnd()).join('\n')}\n\n`
}

/** `quote` added to what is already written, set apart by a blank line. */
export function appendQuote(current: string, quote: string): string {
  return current.trim() === '' ? quote : `${current.trimEnd()}\n\n${quote}`
}
