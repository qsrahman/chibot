import type { ResponseUsage } from 'openai/resources/responses/responses'
import { messageText } from '../shared/messages.ts'
import type { StoredItem } from '../shared/types.ts'
import { addUsage } from './usage.ts'

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
  text: string
  /** The model's reasoning summary, `''` if it gave none. */
  thinking: string
  tools: ToolActivity[]
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
 * answer it (reasoning, tool calls, messages, …) as one answer. Only message
 * text, thoughts and tool activity are shown. The answer's usage is the sum
 * of its responses', and its model the last one named.
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
      tools: [],
      usage: null,
      model: null,
      versions: versionsOf(item),
    }
    if (message) {
      turn.answer.text = join(turn.answer.text, message.text)
    }
    if (item.data.type === 'compaction') turn.compacted = true
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
    if (item.usage) turn.answer.usage = addUsage(turn.answer.usage, item.usage)
    if (item.model) turn.answer.model = item.model
  }
  return turns
}

/**
 * The tool calls waiting for the user's approval: those without an output
 * at the end of the conversation (chibot answers all others).
 */
export function waitingCalls(turns: Turn[]): ToolActivity[] {
  return turns.at(-1)?.answer?.tools.filter((t) => t.output === null) ?? []
}

/** A page an answer searched or read. */
export interface Source {
  url: string
  title: string
}

/** The pages an answer found with `web_search` or read with `fetch_url`. */
export function sourcesOf(answer: Answer): Source[] {
  const found = new Map<string, Source>()
  for (const tool of answer.tools) {
    if (!tool.output || tool.output.startsWith('Error:')) continue
    if (tool.name === 'web_search') {
      const { results = [] } = parseJson<{ results?: Source[] }>(tool.output)
      for (const { url, title } of results) found.set(url, { url, title })
    } else if (tool.name === 'fetch_url') {
      const { url } = parseJson<{ url?: string }>(tool.arguments)
      if (url && !found.has(url)) found.set(url, { url, title: url })
    }
  }
  return [...found.values()]
}

const IMAGE_TOOLS = ['generate_image', 'edit_image']

/**
 * The image an image tool made: its file id, `'pending'` while it's being
 * made, or `null` (another tool, or it failed).
 */
export function imageOf(tool: ToolActivity): string | 'pending' | null {
  if (!IMAGE_TOOLS.includes(tool.name)) return null
  if (tool.output === null) return 'pending'
  return parseJson<{ image_id?: string }>(tool.output).image_id ?? null
}

function parseJson<T extends object>(text: string): Partial<T> {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' ? (value as T) : {}
  } catch {
    return {}
  }
}

/** Joins paragraphs with a blank line. */
const join = (text: string, more: string) =>
  text ? `${text}\n\n${more}` : more

function versionsOf(item: StoredItem): Versions | null {
  if (item.siblingIds.length < 2) return null
  return { index: item.siblingIds.indexOf(item.id) + 1, ids: item.siblingIds }
}
