import type { ResponseUsage } from 'openai/resources/responses/responses'
import { fileParts, messageText } from '../shared/messages.ts'
import type { StoredItem } from '../shared/types.ts'
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
          attachments: attachmentsOf(item.data),
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

/** A page, past chat or project file an answer searched or read. */
export interface Source {
  url: string
  title: string
  /** A chat in chibot (`/c/:id`) or a project file, not a web page. */
  kind?: 'chat' | 'file'
}

/**
 * The pages an answer found with `web_search` or read with `fetch_url`, the
 * chats it found with `search_chats`, and the project files it found with
 * `search_project_files`.
 */
export function sourcesOf(answer: Answer): Source[] {
  const found = new Map<string, Source>()
  for (const tool of answer.tools) {
    for (const source of toolSources(tool)) {
      // A page read after it was found keeps its search result's title.
      if (tool.name !== 'fetch_url' || !found.has(source.url)) {
        found.set(source.url, source)
      }
    }
  }
  return [...found.values()]
}

/** The sources one tool call found or read (see `sourcesOf`). */
function toolSources(tool: ToolActivity): Source[] {
  if (!tool.output || tool.output.startsWith('Error:')) return []
  const found = new Map<string, Source>()
  if (tool.name === 'web_search') {
    const { results } = parseJson<{ results?: unknown }>(tool.output)
    for (const row of rows(results)) {
      const url = webUrl(row.url)
      if (!url) continue
      found.set(url.href, {
        url: url.href,
        title: sourceTitle(row.title, url.href),
      })
    }
  } else if (tool.name === 'search_chats') {
    const { results } = parseJson<{ results?: unknown }>(tool.output)
    for (const row of rows(results)) {
      if (typeof row.chat_id !== 'string' || !row.chat_id) continue
      const url = `/c/${encodeURIComponent(row.chat_id)}`
      found.set(url, {
        url,
        title: sourceTitle(row.title, 'Chat'),
        kind: 'chat',
      })
    }
  } else if (tool.name === 'search_project_files') {
    const { results } = parseJson<{ results?: unknown }>(tool.output)
    for (const row of rows(results)) {
      if (typeof row.file_id !== 'string' || !row.file_id) continue
      const url = `/api/files/${encodeURIComponent(row.file_id)}`
      found.set(url, {
        url,
        title: sourceTitle(row.file, 'Project file'),
        kind: 'file',
      })
    }
  } else if (tool.name === 'fetch_url') {
    const { url } = parseJson<{ url?: unknown }>(tool.arguments)
    const parsed = webUrl(url)
    if (parsed) found.set(parsed.href, { url: parsed.href, title: parsed.href })
  }
  return [...found.values()]
}

/** What a tool call did, in people's terms (its raw call stays available). */
export interface ToolSummary {
  /** What it was asked: the query, calculation, page or prompt. */
  input: string | null
  /** A short result: the answer, the change made, or the error. */
  result: string | null
  /** What it found. */
  links: Source[]
}

const SEARCHES = ['web_search', 'search_chats', 'search_project_files']

/** `tool` summarized for its details, or `null` for tools shown raw. */
export function summarizeTool(tool: ToolActivity): ToolSummary | null {
  const args = parseJson<Record<string, unknown>>(tool.arguments)
  const arg = (key: string) => {
    const value = args[key]
    return typeof value === 'string' && value ? value : null
  }
  const error = tool.output?.startsWith('Error:') ? tool.output : null
  if (SEARCHES.includes(tool.name)) {
    const links = toolSources(tool)
    const empty = tool.output !== null && !error && links.length === 0
    return {
      input: arg('query'),
      result: error ?? (empty ? 'Nothing found' : null),
      links,
    }
  }
  switch (tool.name) {
    case 'calculator':
      return { input: arg('expression'), result: tool.output, links: [] }
    case 'memory':
      return { input: null, result: tool.output, links: [] }
    case 'fetch_url':
      return { input: arg('url'), result: error, links: [] }
    case 'generate_image':
    case 'edit_image':
      return { input: arg('prompt'), result: error, links: [] }
    default:
      return null
  }
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          typeof row === 'object' && row !== null,
      )
    : []
}

function webUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function sourceTitle(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

const IMAGE_TOOLS = ['generate_image', 'edit_image']

/**
 * The images a tool made or returned (file ids), `['pending']` while an
 * image tool is making one, or none (another tool, or it failed). MCP tools
 * (`<server>__<tool>`) list theirs as `image_ids`.
 */
export function imagesOf(tool: ToolActivity): (string | 'pending')[] {
  if (IMAGE_TOOLS.includes(tool.name)) {
    if (tool.output === null) return ['pending']
    const id = parseJson<{ image_id?: string }>(tool.output).image_id
    return id ? [id] : []
  }
  if (!tool.name.includes('__') || tool.output === null) return []
  const ids = parseJson<{ image_ids?: unknown }>(tool.output).image_ids
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === 'string')
    : []
}

function parseJson<T extends object>(text: string): Partial<T> {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' ? (value as T) : {}
  } catch {
    return {}
  }
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
