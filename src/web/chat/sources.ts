import { mcpToolName } from '../settings/mcp.ts'
import { parseJson } from './toolJson.ts'
import type { Answer, ToolActivity } from './turns.ts'

/** A page, past chat or project file an answer searched or read. */
export interface Source {
  url: string
  title: string
  /** A chat in chibot (`/c/:id`) or a project file, not a web page. */
  kind?: 'chat' | 'file'
  /** What the search found there, for the card a citation opens. */
  snippet?: string
}

/** Where a source is from, in a few words: a site's host, or what kind of thing it is. */
export function sourceHost({ url, kind }: Source): string {
  if (kind) return kind === 'chat' ? 'Your chats' : 'Project file'
  return URL.parse(url)?.hostname ?? url
}

const SNIPPET_LENGTH = 200

/** `value` as a one-line snippet of at most 200 characters, or nothing. */
function snippetOf(value: unknown): { snippet: string } | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return {
    snippet:
      text.length > SNIPPET_LENGTH
        ? `${text.slice(0, SNIPPET_LENGTH - 1)}…`
        : text,
  }
}

/**
 * The pages an answer found with `web_search` or read with `fetch_url` (tools
 * of chats made before web search and reading pages moved to MCP servers: they
 * are still shown, the new ones are not parsed), the
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
export function toolSources(tool: ToolActivity): Source[] {
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
        ...snippetOf(row.snippet ?? row.description),
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
        ...snippetOf(
          rows(row.messages).find((m) => typeof m.excerpt === 'string')
            ?.excerpt,
        ),
      })
    }
  } else if (tool.name === 'search_project_files') {
    const { results } = parseJson<{ results?: unknown }>(tool.output)
    for (const row of rows(results)) {
      if (typeof row.file_id !== 'string' || !row.file_id) continue
      // A PDF opens at the page the passage is on.
      const page = typeof row.page === 'number' ? row.page : null
      const url = `/api/files/${encodeURIComponent(row.file_id)}${page ? `#page=${page}` : ''}`
      const name = sourceTitle(row.file, 'Project file')
      found.set(url, {
        url,
        title: page ? `${name} · p. ${page}` : name,
        kind: 'file',
        ...snippetOf(row.text),
      })
    }
  } else if (tool.name === 'read_project_file') {
    const { file, file_id } = parseJson<{ file?: unknown; file_id?: unknown }>(
      tool.output,
    )
    if (typeof file_id === 'string' && file_id) {
      const url = `/api/files/${encodeURIComponent(file_id)}`
      found.set(url, {
        url,
        title: sourceTitle(file, 'Project file'),
        kind: 'file',
      })
    }
  } else if (tool.name === 'fetch_url') {
    const { url } = parseJson<{ url?: unknown }>(tool.arguments)
    const parsed = webUrl(url)
    if (parsed) found.set(parsed.href, { url: parsed.href, title: parsed.href })
  } else {
    for (const source of mcpSources(tool)) found.set(source.url, source)
  }
  return [...found.values()]
}

// MCP tools that search or read the web, by their own name (`brave_web_search`,
// `fetch`, `scrape`…): a tool that merely has a URL in its data (issues, files)
// is not a source of the answer.
const WEB_TOOL = /search|fetch|scrape|crawl|browse|extract|read_?(url|page)/i

/**
 * The pages an MCP web search or page-reading tool found or read. Servers
 * differ in what they send, so this takes the two common shapes: JSON, in the
 * whole output or one value to a paragraph (Brave's), where any object with a
 * web address and a title is a result; and text with `Title:`, `URL:` and
 * `Description:` lines. A page-reading tool called with a `url` argument read
 * that page.
 */
function mcpSources(tool: ToolActivity): Source[] {
  const name = mcpToolName(tool.name)?.tool
  if (!name || !WEB_TOOL.test(name) || !tool.output) return []
  // Image tools' output wraps the text.
  const wrapped = parseJson<{ result?: unknown }>(tool.output).result
  const output = typeof wrapped === 'string' ? wrapped : tool.output
  const found: Source[] = []
  const add = (url: unknown, title: unknown, snippet: unknown) => {
    const parsed = webUrl(url)
    if (parsed) {
      found.push({
        url: parsed.href,
        title: sourceTitle(title, parsed.href),
        ...snippetOf(snippet),
      })
    }
  }
  const walk = (value: unknown, depth = 0) => {
    if (depth > 6 || typeof value !== 'object' || value === null) return
    const row = value as Record<string, unknown>
    if (!Array.isArray(value) && typeof (row.url ?? row.link) === 'string') {
      add(
        row.url ?? row.link,
        row.title ?? row.name,
        row.description ?? row.snippet ?? row.content,
      )
    }
    for (const child of Object.values(value)) walk(child, depth + 1)
  }
  for (const chunk of [output, ...output.split(/\n\s*\n/)]) {
    const text = chunk.trim()
    if (!text) continue
    if (/^[[{]/.test(text)) {
      const before = found.length
      walk(parseJson(text))
      // Whole output parsed: its chunks are the same results again.
      if (before < found.length && chunk === output) break
    } else {
      const line = (label: string) =>
        new RegExp(`^\\W*${label}:\\s*(.+)$`, 'im').exec(text)?.[1]?.trim()
      add(line('(?:url|link)'), line('title'), line('(?:description|snippet)'))
    }
  }
  if (found.length === 0) {
    const { url } = parseJson<{ url?: unknown }>(tool.arguments)
    if (/fetch|scrape|crawl|browse|extract|read/i.test(name)) {
      add(url, null, null)
    }
  }
  return found
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
