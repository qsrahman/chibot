import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool as McpToolDefinition,
  type Transport,
} from '@modelcontextprotocol/client'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/client/stdio'
import type { McpServerStatus } from '../shared/types.ts'
import type { McpServerConfig } from './mcp-config.ts'

const CONNECT_TIMEOUT = 10_000
const CALL_TIMEOUT = 60_000
// Function names: ^[A-Za-z0-9_-]{1,64}$.
const MAX_TOOL_NAME = 64

/** A tool a connected server offers, by the name the model calls it. */
export interface McpServerTool {
  name: string
  server: string
  definition: McpToolDefinition
}

interface Server {
  config: McpServerConfig
  state: McpServerStatus['state']
  error: string | null
  client: Client | null
  transport: Transport | null
  tools: McpServerTool[]
}

/**
 * The MCP servers from `mcp.json`: connects the enabled ones, keeps their
 * status and tool lists current, and calls their tools.
 */
export class McpServers {
  readonly #servers = new Map<string, Server>()
  readonly #disabled: () => readonly string[]

  /**
   * @param options.disabled the servers switched off in Settings, read on
   *   `start()` and `sync()`
   */
  constructor(
    configs: Record<string, McpServerConfig>,
    { disabled }: { disabled: () => readonly string[] },
  ) {
    this.#disabled = disabled
    for (const [name, config] of Object.entries(configs)) {
      this.#servers.set(name, {
        config,
        state: 'disabled',
        error: null,
        client: null,
        transport: null,
        tools: [],
      })
    }
  }

  /** Connects every enabled server, in parallel; failures are recorded. */
  start(): Promise<void> {
    return this.sync()
  }

  /** Connects servers switched on and disconnects those switched off. */
  async sync(): Promise<void> {
    const disabled = new Set(this.#disabled())
    await Promise.all(
      [...this.#servers].map(([name, server]) => {
        if (disabled.has(name)) {
          return server.state === 'disabled' ? null : this.disconnect(name)
        }
        return server.state === 'disabled' ? this.connect(name) : null
      }),
    )
  }

  /** (Re)connects `name`, e.g. after it failed. */
  async connect(name: string): Promise<void> {
    const server = this.#get(name)
    await this.#close(server)
    Object.assign(server, { state: 'connecting', error: null, tools: [] })
    const client = new Client({ name: 'chibot', version: '1' })
    const transport = transportFor(server.config)
    server.client = client
    server.transport = transport
    try {
      await client.connect(transport, { timeout: CONNECT_TIMEOUT })
      client.setNotificationHandler(
        'notifications/tools/list_changed',
        async () => {
          if (server.client === client)
            server.tools = await listTools(name, client)
        },
      )
      server.tools = await listTools(name, client)
      server.state = 'connected'
      // Set after connecting: a crash or a dropped connection from now on.
      client.onclose = () => {
        if (server.client !== client) return
        Object.assign(server, {
          state: 'failed',
          error: stderrOf(transport) ?? 'The server stopped',
          client: null,
          transport: null,
          tools: [],
        })
      }
    } catch (err) {
      if (server.client !== client) return
      await this.#close(server)
      Object.assign(server, {
        state: 'failed',
        error: stderrOf(transport) ?? (err as Error).message,
      })
    }
  }

  /** Disconnects `name` (a local server's process stops). */
  async disconnect(name: string): Promise<void> {
    const server = this.#get(name)
    await this.#close(server)
    Object.assign(server, { state: 'disabled', error: null, tools: [] })
  }

  statuses(): McpServerStatus[] {
    return [...this.#servers].map(([name, server]) => ({
      name,
      type: server.config.type,
      state: server.state,
      error: server.error,
      tools: server.tools.map(({ name, definition }) => ({
        name,
        title:
          definition.title ?? definition.annotations?.title ?? definition.name,
        description: definition.description ?? '',
      })),
    }))
  }

  /** The connected servers' tools. */
  tools(): McpServerTool[] {
    return [...this.#servers.values()].flatMap((s) =>
      s.state === 'connected' ? s.tools : [],
    )
  }

  /** Calls the tool the model knows as `name`; Stop (`signal`) cancels it. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    const tool = this.tools().find((t) => t.name === name)
    const client = tool && this.#get(tool.server).client
    if (!tool || !client) throw new Error(`${name} isn’t available now`)
    return client.callTool(
      { name: tool.definition.name, arguments: args },
      { signal, timeout: CALL_TIMEOUT },
    ) as Promise<CallToolResult>
  }

  /** The process of a connected local server (for tests). */
  pid(name: string): number | null {
    const transport = this.#get(name).transport
    return transport instanceof StdioClientTransport ? transport.pid : null
  }

  async close(): Promise<void> {
    await Promise.all([...this.#servers.values()].map((s) => this.#close(s)))
  }

  #get(name: string): Server {
    const server = this.#servers.get(name)
    if (!server) throw new Error(`No MCP server is called ${name}`)
    return server
  }

  async #close(server: Server): Promise<void> {
    const { client } = server
    server.client = null
    server.transport = null
    await client?.close().catch(() => {})
  }
}

function transportFor(config: McpServerConfig): Transport {
  if (config.type === 'remote') {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    })
  }
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    // Only the safe defaults (PATH, HOME, …): never chibot's own keys.
    env: { ...getDefaultEnvironment(), ...config.env },
    cwd: config.cwd,
    // Kept for error messages instead of mixing into chibot's output.
    stderr: 'pipe',
  })
  keepStderr(transport)
  return transport
}

/** All of a server's tools (they may come in pages), named for the model. */
async function listTools(
  server: string,
  client: Client,
): Promise<McpServerTool[]> {
  const definitions: McpToolDefinition[] = []
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined)
    definitions.push(...page.tools)
    cursor = page.nextCursor
  } while (cursor)
  const taken = new Set<string>()
  return definitions.map((definition) => {
    let name = `${server}__${definition.name}`
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, MAX_TOOL_NAME)
    // Cutting long names can make two alike.
    for (let n = 2; taken.has(name); n++) {
      name = `${name.slice(0, MAX_TOOL_NAME - String(n).length - 1)}_${n}`
    }
    taken.add(name)
    return { name, server, definition }
  })
}

// A local server's last stderr lines usually say why it failed.
const stderrLog = new WeakMap<Transport, string>()

function stderrOf(transport: Transport): string | null {
  if (!(transport instanceof StdioClientTransport)) return null
  const text = stderrLog.get(transport)?.trim()
  return text ? text.split('\n').slice(-3).join('\n') : null
}

function keepStderr(transport: StdioClientTransport): void {
  transport.stderr?.on('data', (chunk: Buffer) => {
    const text = (stderrLog.get(transport) ?? '') + chunk.toString()
    stderrLog.set(transport, text.slice(-2000))
  })
}
