import { sourceKey } from './sourcesContext.ts'
import type { Source } from './turns.ts'

/**
 * A citation is a link to one of the answer's sources whose text is only its
 * number: `[1](https://…)` or `[[1]](https://…)`. The model can't know the
 * numbers the chat gives its sources (a tool's output isn't numbered), but it
 * knows the address, so the address is what ties a claim to a source, and the
 * number shown is the source's place in the answer's list.
 */
export const isCitationLabel = (text: string) => /^\[?\d{1,3}\]?$/.test(text)

/** The numbers (1-based) of the sources the text cites, in order, once each. */
export function citedNumbers(text: string, sources: Source[]): number[] {
  const keys = sources.map((s) => sourceKey(s.url))
  const cited = new Set<number>()
  for (const [, label, href] of text.matchAll(
    /\[(\[?\d{1,3}\]?)\]\(([^)\s]+)\)/g,
  )) {
    const at = keys.indexOf(sourceKey(href!))
    if (at >= 0 && isCitationLabel(label!)) cited.add(at + 1)
  }
  return [...cited]
}
