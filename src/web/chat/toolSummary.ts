import { mcpToolName } from '../settings/mcp.ts'
import { toolSources, type Source } from './sources.ts'
import { imagesOf } from './toolImages.ts'
import { parseJson } from './toolJson.ts'
import type { ToolActivity } from './turns.ts'

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

/** What a finished call came to, in a few words for its row; `null` while it runs. */
export function toolPreview(
  tool: ToolActivity,
): { text: string; failed: boolean } | null {
  if (tool.output === null) return null
  if (tool.output.startsWith('Error:')) {
    return { text: clip(tool.output.slice('Error:'.length)), failed: true }
  }
  const args = parseJson<Record<string, unknown>>(tool.arguments)
  const arg = (key: string) =>
    typeof args[key] === 'string' && args[key] ? (args[key] as string) : null
  const count = (n: number, noun: string) =>
    n === 0 ? 'Nothing found' : `${n} ${noun}${n === 1 ? '' : 's'}`
  const ok = (text: string | null) =>
    text ? { text: clip(text), failed: false } : null
  switch (tool.name) {
    case 'web_search':
      return ok(count(toolSources(tool).length, 'result'))
    case 'search_chats':
      return ok(count(toolSources(tool).length, 'chat'))
    case 'search_project_files':
      return ok(count(toolSources(tool).length, 'passage'))
    case 'fetch_url':
      return ok(URL.parse(arg('url') ?? '')?.hostname ?? null)
    case 'read_project_file':
      return ok(arg('file'))
    case 'generate_image':
    case 'edit_image':
      return ok(arg('prompt'))
    case 'memory':
      return ok(tool.output.split('\n')[0] ?? null)
  }
  if (mcpToolName(tool.name)) {
    const { result } = parseJson<{ result?: unknown }>(tool.output)
    return ok(typeof result === 'string' ? result.split('\n')[0]! : null)
  }
  return null
}

/** The first line of `text`, cut to fit a row. */
function clip(text: string): string {
  const line = text.trim().split('\n')[0]!
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

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
    case 'memory':
      return { input: null, result: tool.output, links: [] }
    case 'fetch_url':
      return { input: arg('url'), result: error, links: [] }
    case 'read_project_file':
      return { input: arg('file'), result: error, links: toolSources(tool) }
    case 'generate_image':
    case 'edit_image':
      return { input: arg('prompt'), result: error, links: [] }
  }
  if (mcpToolName(tool.name)) {
    // The arguments as sent, and the text the model got (without the image
    // ids, whose images show in the answer).
    const { result } = parseJson<{ result?: unknown }>(tool.output ?? '')
    return {
      input: Object.keys(args).length > 0 ? JSON.stringify(args) : null,
      result:
        imagesOf(tool).length > 0 && typeof result === 'string'
          ? result
          : tool.output,
      links: [],
    }
  }
  return null
}
