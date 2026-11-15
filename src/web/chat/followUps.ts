import { nextStepOf, type Turn } from './turns.ts'

/**
 * The saved answer to suggest follow-ups for: the newest turn's, when it
 * finished (not stopped or cut off) and nothing waits for approval. Else `null`.
 * An answer with a next-step card gets none: the card is the model's own offer,
 * so a second row of suggestions would compete with it (and cost a request).
 */
export function suggestionTarget(
  turns: Turn[],
  waiting: number,
): number | null {
  const answer = turns.at(-1)?.answer
  if (!answer || answer.incomplete || waiting > 0) return null
  if (nextStepOf(answer)) return null
  return answer.itemId
}

/** Suggestions found for one answer of one chat. */
export interface Found {
  chatId: string
  itemId: number
  suggestions: string[]
}

/**
 * What to show: the suggestions made for the newest answer of this chat, once
 * nothing runs or waits to be sent. Any other answer (a new message, a
 * regeneration, another version) shows none.
 */
export function shownSuggestions(
  found: Found | null,
  chatId: string | undefined,
  target: number | null,
  idle: boolean,
): string[] {
  if (!found || !idle || found.chatId !== chatId || found.itemId !== target) {
    return []
  }
  return found.suggestions
}
