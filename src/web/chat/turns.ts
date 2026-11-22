import type {
  ResponseInputItem,
  ResponseUsage,
} from 'openai/resources/responses/responses'
import { fileParts, messageText } from '../../shared/messages.ts'
import type { Compaction, StoredItem, UsedMemory } from '../../shared/types.ts'
import { addUsage } from './usage.ts'

/** Where an item sits among its alternatives: `index` is 1-based. */
export interface Versions {
  index: number
  ids: number[]
}

/** A file attached to a message (`/api/files/:fileId`). */
export interface Attachment {
  fileId: string
  /** Shown as a thumbnail; other files as a card with their name. */
  image: boolean
  /** Documents' file names (images' aren't stored with the message). */
  name: string | null
}

export interface Question {
  /** `null` until the server has saved it (e.g. shown after a Stop). */
  itemId: number | null
  parentId: number | null
  text: string
  attachments: Attachment[]
  /** Edits of this message, or `null` if it was never edited. */
  versions: Versions | null
}

/** A tool the model called while answering. */
export interface ToolActivity {
  callId: string
  name: string
  /** The call's arguments, as JSON text. */
  arguments: string
  /** `null` while running, or while waiting for the user's approval. */
  output: string | null
}

export interface Answer {
  itemId: number | null
  /** When the answer's first item was stored; unset while it is still arriving. */
  createdAt?: number
  text: string
  /** The model's reasoning summary, `''` if it gave none. */
  thinking: string
  tools: ToolActivity[]
  /** Tokens used by all of the answer's responses (a tool call makes another). */
  usage: ResponseUsage | null
  /**
   * What its last response used. Each response sends the whole context, so
   * this, not the sum, is the context's size.
   */
  lastUsage: ResponseUsage | null
  /** The model that wrote it, if known. */
  model: string | null
  /** The saved memories that were in its instructions, as they were then. */
  memories: UsedMemory[]
  /** Regenerations of this answer, or `null` if there are none. */
  versions: Versions | null
  /** It stopped before it was finished (stopped by the user, or cut off by the model's limit). */
  incomplete: boolean
}

/** The answer stopped early or never came, and the question was saved: it can be answered again. */
export const interrupted = ({ question, answer }: Turn) =>
  answer ? answer.incomplete : question.itemId !== null

/** A user message and the answer to it, as the chat shows them. */
export interface Turn {
  key: string
  question: Question
  /** `null` when the request failed or was stopped before any text. */
  answer: Answer | null
  /** The summary that stands in for the messages before this turn, if any. */
  compaction: Compaction | null
}

/**
 * Groups a path into turns: each user message, then the output items that
 * answer it (reasoning, tool calls, messages, …) as one answer. Only message
 * text, thoughts and tool activity are shown. The answer's usage is the sum
 * of its responses' (`lastUsage`: the last one's), and its model the last one named.
 */
export function toTurns(
  items: StoredItem[],
  compactions: Compaction[] = [],
): Turn[] {
  const turns: Turn[] = []
  // A summary is shown where the messages it replaced end: before the turn
  // that starts right after the item it was cut at.
  const after = new Map(
    compactions.flatMap((c) => {
      const next = items[items.findIndex((i) => i.id === c.upToItemId) + 1]
      return next ? [[next.id, c] as const] : []
    }),
  )
  for (const item of items) {
    const message = messageText(item.data)
    if (message?.role === 'user') {
      turns.push({
        key: String(item.id),
        question: {
          itemId: item.id,
          parentId: item.parentId,
          text: message.text,
          attachments: attachmentsOf(item.data),
          versions: versionsOf(item),
        },
        answer: null,
        compaction: after.get(item.id) ?? null,
      })
      continue
    }
    const turn = turns.at(-1)
    if (!turn) continue
    // A cut inside a turn (a long run of tool calls) shows at that turn's top.
    turn.compaction ??= after.get(item.id) ?? null
    turn.answer ??= {
      itemId: item.id,
      createdAt: item.createdAt,
      text: '',
      thinking: '',
      tools: [],
      usage: null,
      lastUsage: null,
      model: null,
      memories: [],
      versions: versionsOf(item),
      incomplete: false,
    }
    if (message) {
      turn.answer.text = join(turn.answer.text, message.text)
      // The last message decides: tool calls may follow an earlier one.
      if (message.role === 'assistant') {
        turn.answer.incomplete = isCutOff(item.data)
      }
    }
    if (item.data.type === 'function_call') {
      const { call_id, name, arguments: args } = item.data
      turn.answer.tools.push({
        callId: call_id,
        name,
        arguments: args,
        output: null,
      })
    }
    if (item.data.type === 'function_call_output') {
      const { call_id, output } = item.data
      const tool = turn.answer.tools.find((t) => t.callId === call_id)
      if (tool) tool.output = typeof output === 'string' ? output : ''
    }
    if (item.data.type === 'reasoning') {
      for (const part of item.data.summary) {
        turn.answer.thinking = join(turn.answer.thinking, part.text)
      }
    }
    if (item.usage) {
      turn.answer.usage = addUsage(turn.answer.usage, item.usage)
      turn.answer.lastUsage = item.usage
    }
    if (item.model) turn.answer.model = item.model
    if (item.memories) turn.answer.memories = item.memories
  }
  return turns
}

/**
 * An assistant message that ended early: one the model marked `incomplete`
 * (its output limit), or the plain-text partial chibot saves when the user
 * stops an answer (completed ones are typed `message` items).
 */
function isCutOff(data: ResponseInputItem): boolean {
  if (!('role' in data) || data.role !== 'assistant') return false
  if (!('type' in data) || data.type === undefined) return true
  return (
    data.type === 'message' && 'status' in data && data.status === 'incomplete'
  )
}

/** A question about to be sent, not yet saved (no item id, no versions). */
export const newQuestion = (
  text: string,
  parentId: number | null,
  attachments: Attachment[],
): Question => ({ itemId: null, parentId, text, attachments, versions: null })

/** The request's `fileIds` for `attachments`: nothing when there are none. */
export const fileIds = (attachments: Attachment[]) =>
  attachments.length > 0 ? { fileIds: attachments.map((a) => a.fileId) } : {}

/**
 * The tool calls waiting for the user's approval: those without an output
 * at the end of the conversation (chibot answers all others).
 */
export function waitingCalls(turns: Turn[]): ToolActivity[] {
  return turns.at(-1)?.answer?.tools.filter((t) => t.output === null) ?? []
}

/** The files a user message attaches. */
const attachmentsOf = (data: StoredItem['data']): Attachment[] =>
  fileParts(data).flatMap((part) =>
    part.file_id
      ? [
          part.type === 'input_image'
            ? { fileId: part.file_id, image: true, name: null }
            : {
                fileId: part.file_id,
                image: false,
                name: part.filename ?? null,
              },
        ]
      : [],
  )

/** Joins paragraphs with a blank line. */
const join = (text: string, more: string) =>
  text ? `${text}\n\n${more}` : more

function versionsOf(item: StoredItem): Versions | null {
  if (item.siblingIds.length < 2) return null
  return { index: item.siblingIds.indexOf(item.id) + 1, ids: item.siblingIds }
}
