import type { ResponseUsage } from 'openai/resources/responses/responses'
import { messageText } from '../shared/messages.ts'
import type { StoredItem } from '../shared/types.ts'

/** Where an item sits among its alternatives: `index` is 1-based. */
export interface Versions {
  index: number
  ids: number[]
}

export interface Question {
  /** `null` until the server has saved it (e.g. shown after a Stop). */
  itemId: number | null
  parentId: number | null
  text: string
  /** Edits of this message, or `null` if it was never edited. */
  versions: Versions | null
}

export interface Answer {
  itemId: number | null
  text: string
  /** The model's reasoning summary, `''` if it gave none. */
  thinking: string
  usage: ResponseUsage | null
  /** The model that wrote it, if known. */
  model: string | null
  /** Regenerations of this answer, or `null` if there are none. */
  versions: Versions | null
}

/** A user message and the answer to it, as the chat shows them. */
export interface Turn {
  key: string
  question: Question
  /** `null` when the request failed or was stopped before any text. */
  answer: Answer | null
  /** The context was compacted for this answer (earlier turns summarized). */
  compacted: boolean
}

/**
 * Groups a path into turns: each user message, then the output items that
 * answer it (reasoning, messages, …) as one answer. Only message text is
 * shown; the last usage and model in the group are the answer's.
 */
export function toTurns(items: StoredItem[]): Turn[] {
  const turns: Turn[] = []
  for (const item of items) {
    const message = messageText(item.data)
    if (message?.role === 'user') {
      turns.push({
        key: String(item.id),
        question: {
          itemId: item.id,
          parentId: item.parentId,
          text: message.text,
          versions: versionsOf(item),
        },
        answer: null,
        compacted: false,
      })
      continue
    }
    const turn = turns.at(-1)
    if (!turn) continue
    turn.answer ??= {
      itemId: item.id,
      text: '',
      thinking: '',
      usage: null,
      model: null,
      versions: versionsOf(item),
    }
    if (message) {
      turn.answer.text = join(turn.answer.text, message.text)
    }
    if (item.data.type === 'compaction') turn.compacted = true
    if (item.data.type === 'reasoning') {
      for (const part of item.data.summary) {
        turn.answer.thinking = join(turn.answer.thinking, part.text)
      }
    }
    if (item.usage) turn.answer.usage = item.usage
    if (item.model) turn.answer.model = item.model
  }
  return turns
}

/** Joins paragraphs with a blank line. */
const join = (text: string, more: string) =>
  text ? `${text}\n\n${more}` : more

function versionsOf(item: StoredItem): Versions | null {
  if (item.siblingIds.length < 2) return null
  return { index: item.siblingIds.indexOf(item.id) + 1, ids: item.siblingIds }
}
