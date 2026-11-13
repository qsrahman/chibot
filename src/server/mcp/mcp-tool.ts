import type { CallToolResult } from '@modelcontextprotocol/client'
import type { FunctionTool } from 'openai/resources/responses/responses'
import { z } from 'zod'
import type { FileStore } from '../file-store.ts'
import type { McpServers, McpServerTool } from './mcp-servers.ts'
import { section } from '../prompt-tags.ts'
import { Tool, type ToolContext } from '../tool.ts'

const MAX_CHARS = 40_000
// A server's notes on its tools are in every request: a server may write pages.
const MAX_NOTES = 2000

// Served back from /api/files with this type, so never SVG (it can script).
const SHOWN_IMAGES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/**
 * A tool of a connected MCP server, offered as `<server>__<tool>`. Calls
 * don't ask first unless its server is set to (`ask` in its config entry);
 * the output is someone else's text.
 */
export class McpTool extends Tool {
  readonly name: string
  readonly label: string
  readonly description: string
  // The server validates the arguments against its own schema.
  readonly parameters = z.looseObject({})
  override readonly untrustedOutput = true
  override readonly requiresApproval: boolean
  override readonly approvalReason: string
  readonly #tool: McpServerTool
  readonly #servers: McpServers
  readonly #files: FileStore

  constructor(
    tool: McpServerTool,
    servers: McpServers,
    files: FileStore,
    asks: boolean,
  ) {
    super()
    this.requiresApproval = asks
    this.approvalReason = `This tool belongs to the MCP server “${tool.server}”, which runs outside chibot, and you set that server to ask first (Settings → Tools). Check the details before approving.`
    const { definition } = tool
    this.name = tool.name
    this.label =
      definition.title ?? definition.annotations?.title ?? definition.name
    this.description = definition.description ?? ''
    this.#tool = tool
    this.#servers = servers
    this.#files = files
  }

  /**
   * The server's own notes on using its tools, when its entry asks for them:
   * the same text from each of its tools, which the chat's instructions show
   * once. It is the server's words, so it sits in a tag naming the server.
   */
  override instructions(): string | null {
    const notes = this.#servers.instructionsOf(this.#tool.server)
    if (!notes) return null
    const text =
      notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES)}…` : notes
    return section('mcp_server', text, ` name="${this.#tool.server}"`)
  }

  /** Not offered while switched off in Settings → Tools. */
  override unavailable(): string | null {
    return this.#servers.toolOff(this.name)
      ? 'Switched off in Settings → Tools'
      : null
  }

  async run(args: Record<string, unknown>, context: ToolContext) {
    const result = await this.#servers.callTool(this.name, args, context.signal)
    return toOutput(result, this.#files, context.conversationId)
  }

  /** The server's own JSON Schema, which needn't fit strict mode. */
  override get declaration(): FunctionTool {
    const { $schema: _, ...parameters } = this.#tool.definition.inputSchema
    return {
      type: 'function',
      name: this.name,
      description: this.description,
      parameters,
      strict: false,
    }
  }
}

// One instance per listed tool, so the same tool is the same object while
// its server's list and approval setting stay (ChatService compares them).
const instances = new WeakMap<McpServerTool, McpTool>()

/**
 * The connected servers' tools, for `ToolRegistry`. Whether a server's calls
 * wait for the user's approval is read on every call.
 */
export function mcpTools(servers: McpServers, files: FileStore) {
  return (): Tool[] =>
    servers.tools().map((tool) => {
      const asks = servers.asks(tool.server)
      let instance = instances.get(tool)
      if (instance?.requiresApproval !== asks) {
        instance = new McpTool(tool, servers, files, asks)
        instances.set(tool, instance)
      }
      return instance
    })
}

/**
 * What the model sees: the text parts (or `structuredContent` as JSON), with
 * a note for each image. Images are kept with the chat and listed as
 * `image_ids` for the web app, which shows them.
 *
 * @throws Error with the server's text for an `isError` result
 */
export function toOutput(
  result: CallToolResult,
  files: FileStore,
  conversationId: string,
): string {
  // `content` is optional in the protocol (a result may carry only
  // `structuredContent`).
  const content = result.content ?? []
  // Kept until the call is known to have succeeded, so an error leaves no
  // files behind (they'd stay with the chat, unreferenced, for good).
  const images: { mimeType: string; data: string }[] = []
  const parts = content.map((part) => {
    switch (part.type) {
      case 'text':
        return part.text
      case 'image': {
        const extension = SHOWN_IMAGES[part.mimeType]
        if (!extension) return `[An image (${part.mimeType}) that isn’t shown]`
        if (result.isError) return '[An image]'
        images.push(part)
        return '[An image, shown to the user]'
      }
      case 'resource':
        return 'text' in part.resource
          ? part.resource.text
          : `[A file: ${part.resource.uri}]`
      case 'resource_link':
        return `[A link: ${part.uri}]`
      default:
        return `[${part.type} content, not shown]`
    }
  })
  let text = parts.join('\n\n')
  if (!content.some((part) => part.type === 'text')) {
    if (result.structuredContent) {
      text = [JSON.stringify(result.structuredContent), text]
        .filter(Boolean)
        .join('\n\n')
    }
  }
  if (text.length > MAX_CHARS)
    text = `${text.slice(0, MAX_CHARS)}\n\n[truncated]`
  if (result.isError) throw new Error(text || 'the tool failed')
  const imageIds = images.map(
    (part) =>
      files.save(
        conversationId,
        `image.${SHOWN_IMAGES[part.mimeType]}`,
        part.mimeType,
        Buffer.from(part.data, 'base64'),
      ).id,
  )
  return imageIds.length > 0
    ? JSON.stringify({ result: text, image_ids: imageIds })
    : text || '(no output)'
}
