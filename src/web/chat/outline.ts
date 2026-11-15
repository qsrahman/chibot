import type { Turn } from './turns.ts'

/** The chat's user messages are listed for jumping from this many on. */
export const OUTLINE_FROM = 4

export interface OutlineItem {
  /** The turn's position in the chat. */
  index: number
  /** The message's first line. */
  label: string
}

/** One line per user message: its first line of text, or what it carries. */
export function outlineOf(turns: Turn[]): OutlineItem[] {
  return turns.map(({ question }, index) => {
    const first = question.text
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
    return {
      index,
      label:
        first ?? (question.attachments.length > 0 ? 'Attachment' : 'Message'),
    }
  })
}

/** The last of the `tops` (each message's distance from the list's top) that is within `within` of it; the first if none is. */
export function currentOutlineIndex(tops: number[], within: number): number {
  const reached = tops.findLastIndex((top) => top <= within)
  return Math.max(reached, 0)
}
