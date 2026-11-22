import { mcpToolName } from '../settings/mcp.ts'
import { parseJson } from './toolJson.ts'
import type { ToolActivity } from './turns.ts'

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
  if (!mcpToolName(tool.name) || tool.output === null) return []
  const ids = parseJson<{ image_ids?: unknown }>(tool.output).image_ids
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === 'string')
    : []
}

/** The proportions generate_image's `size` gives, so the space is held before the picture arrives. */
const RATIOS: Record<string, string> = {
  square: '1 / 1',
  landscape: '3 / 2',
  portrait: '2 / 3',
}

/** What describes a tool's image: alt text, and its proportions when known. */
export function imageInfo(tool: ToolActivity): {
  alt: string
  ratio: string | undefined
} {
  const { prompt, size } = parseJson<{ prompt?: unknown; size?: unknown }>(
    tool.arguments,
  )
  const text = typeof prompt === 'string' ? prompt.trim() : ''
  const label = tool.name === 'edit_image' ? 'Edited image' : 'Generated image'
  return {
    alt: text ? `${label}: ${text.slice(0, 120)}` : label,
    ratio:
      tool.name === 'generate_image' && typeof size === 'string'
        ? RATIOS[size]
        : undefined,
  }
}
