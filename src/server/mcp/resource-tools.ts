import { z } from 'zod'
import type { ToolInfo } from '../../shared/tools.ts'
import { Tool, type ToolContext } from '../tool.ts'
import { MAX_CHARS } from './mcp-tool.ts'
import type { McpResources, McpServers } from './mcp-servers.ts'

// A server may list thousands; the model gets this many of each kind from each.
const LISTED = 100

const WHY_ASKS =
  'Some of the MCP servers that offer resources are set to ask first (Settings → Tools), and what a resource holds is the server’s own text. Check which one it reads from.'

/** The resources a server offers, in words for the model. */
function describe({ server, resources, templates, error }: McpResources) {
  const lines = [`Server ${server}:`]
  if (error) lines.push(`  (could not list: ${error})`)
  for (const r of resources.slice(0, LISTED)) {
    const facts = [r.mimeType, r.size === undefined ? null : `${r.size} bytes`]
      .filter(Boolean)
      .join(', ')
    lines.push(
      `- ${r.uri}: ${r.title ?? r.name}${facts ? ` (${facts})` : ''}${r.description ? `: ${r.description}` : ''}`,
    )
  }
  if (resources.length > LISTED) {
    lines.push(`  …and ${resources.length - LISTED} more resources`)
  }
  for (const t of templates.slice(0, LISTED)) {
    lines.push(
      `- template ${t.uriTemplate}: ${t.title ?? t.name}${t.description ? `: ${t.description}` : ''}`,
    )
  }
  if (templates.length > LISTED) {
    lines.push(`  …and ${templates.length - LISTED} more templates`)
  }
  if (!error && resources.length + templates.length === 0) {
    lines.push('  (nothing listed)')
  }
  return lines.join('\n')
}

/** What the tools show about a server that was named, or any one set to ask. */
function asksAbout(servers: McpServers, server: string | null): boolean {
  return server === null
    ? servers.resourceServers().some((name) => servers.asks(name))
    : servers.asks(server)
}

const UNAVAILABLE = 'No connected MCP server offers resources.'

/** Lists what the connected MCP servers offer to read. */
export class ListMcpResourcesTool extends Tool {
  readonly name = 'list_mcp_resources'
  readonly label = 'List MCP resources'
  override readonly group = 'MCP resources'
  override readonly summary =
    'Lets the model list and read what MCP servers offer as resources (files, documents, records). What a resource holds is the server’s own text.'
  override readonly running = 'Listing MCP resources…'
  override readonly done = 'Listed MCP resources'
  readonly description =
    'Lists the resources (files, documents, records) that connected MCP servers offer, with the URI to read each with read_mcp_resource, and the URI templates a resource can be named by. Use it when the user asks about something a server may hold.'
  readonly parameters = z.object({
    server: z
      .string()
      .nullable()
      .describe('The MCP server to list, as the user named it; null for all'),
  })
  override readonly untrustedOutput = true
  readonly #servers: McpServers

  constructor(servers: McpServers) {
    super()
    this.#servers = servers
  }

  override unavailable() {
    return this.#servers.resourceServers().length > 0 ? null : UNAVAILABLE
  }

  override get info(): ToolInfo {
    return { ...super.info, approval: WHY_ASKS }
  }

  override asksFor({ server }: z.output<typeof this.parameters>) {
    return asksAbout(this.#servers, server)
  }

  async run(
    { server }: z.output<typeof this.parameters>,
    context: ToolContext,
  ) {
    const listed = await this.#servers.listResources(server, context.signal)
    const text = listed.map(describe).join('\n\n')
    return text.length > MAX_CHARS
      ? `${text.slice(0, MAX_CHARS)}\n\n[truncated]`
      : text
  }
}

/** Reads one resource of an MCP server. */
export class ReadMcpResourceTool extends Tool {
  readonly name = 'read_mcp_resource'
  readonly label = 'Read MCP resources'
  override readonly group = 'MCP resources'
  override readonly summary =
    'Reads a resource that an MCP server offers (see MCP resources). What it holds is the server’s own text.'
  override readonly running = 'Reading an MCP resource…'
  override readonly done = 'Read an MCP resource'
  readonly description =
    'Reads one resource of an MCP server: its text. Name the server and the URI from list_mcp_resources (or one the user gave, or made from a URI template).'
  readonly parameters = z.object({
    server: z.string().describe('The MCP server that offers the resource'),
    uri: z.string().describe('The resource’s URI'),
  })
  override readonly untrustedOutput = true
  readonly #servers: McpServers

  constructor(servers: McpServers) {
    super()
    this.#servers = servers
  }

  override unavailable() {
    return this.#servers.resourceServers().length > 0 ? null : UNAVAILABLE
  }

  override get info(): ToolInfo {
    return { ...super.info, approval: WHY_ASKS }
  }

  override asksFor({ server }: z.output<typeof this.parameters>) {
    return asksAbout(this.#servers, server)
  }

  async run(
    { server, uri }: z.output<typeof this.parameters>,
    context: ToolContext,
  ) {
    const contents = await this.#servers.readResource(
      server,
      uri,
      context.signal,
    )
    const text = contents
      .map((part) =>
        'text' in part
          ? part.text
          : `[A file (${part.mimeType ?? 'unknown type'}) that isn’t shown]`,
      )
      .join('\n\n')
    if (text.length > MAX_CHARS) {
      return `${text.slice(0, MAX_CHARS)}\n\n[truncated]`
    }
    return text || '(empty)'
  }
}
