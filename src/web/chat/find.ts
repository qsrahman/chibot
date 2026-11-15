/** Where `query` occurs in `text`, ignoring case; the matches don't overlap. */
export function matchOffsets(text: string, query: string): number[] {
  if (!query) return []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  // Lower-casing can change a text's length (İ); the offsets would then not be the text's.
  if (haystack.length !== text.length) return []
  const found: number[] = []
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    found.push(at)
  }
  return found
}

/** The find bar's count: "3 of 12", or what's missing. */
export function matchLabel(
  query: string,
  current: number,
  count: number,
): string {
  if (!query) return ''
  return count === 0 ? 'No matches' : `${current + 1} of ${count}`
}

/** The match after (or before) `current`, wrapping round. */
export const stepMatch = (current: number, count: number, back: boolean) =>
  count === 0 ? 0 : (current + (back ? count - 1 : 1)) % count

/**
 * The ranges in `root` where `query` occurs in the text a reader can see:
 * not in a closed <details> (Thoughts, tool calls) apart from its summary, nor
 * in buttons. A word split by markup (**bo**ld) is not found.
 */
export function findRanges(root: Element, query: string): Range[] {
  const ranges: Range[] = []
  if (!query) return ranges
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT
        const el = node as Element
        if (el.matches('button, .visually-hidden, [aria-hidden="true"]'))
          return NodeFilter.FILTER_REJECT
        // Only the summary of a closed <details> is shown.
        if (el.matches('details:not([open]) > :not(summary)'))
          return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_SKIP
      },
    },
  )
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const at of matchOffsets(node.nodeValue ?? '', query)) {
      const range = new Range()
      range.setStart(node, at)
      range.setEnd(node, at + query.length)
      ranges.push(range)
    }
  }
  return ranges
}

/**
 * Scrolls `el` into view at once. A turn that was not drawn yet is laid out at
 * a guessed size, and moves once it is, so the scroll is repeated a frame later.
 */
export function jumpTo(
  el: Element | null | undefined,
  block: ScrollLogicalPosition,
) {
  el?.scrollIntoView({ block })
  requestAnimationFrame(() => el?.scrollIntoView({ block }))
}
