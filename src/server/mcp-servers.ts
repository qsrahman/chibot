import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool as McpToolDefinition,
  type Transport,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/client/stdio'
import { homedir } from 'node:os'
import type { McpServerStatus } from '../shared/types.ts'
import { McpSignIn, type McpAuthStore } from './mcp-auth.ts'
import type { McpServerConfig } from './mcp-config.ts'

// A local server may first have to download itself (`npx -y …`).
const CONNECT_TIMEOUT = { local: 60_000, remote: 10_000 }
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
  /** A remote server's OAuth sign-in (none with its own Authorization). */
  signIn: McpSignIn | null
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
   * @param options.auth where remote servers' sign-ins are kept, and the
   *   OAuth callback's URL; without it they can't sign in
   */
  constructor(
    configs: Record<string, McpServerConfig>,
    {
      disabled,
      auth,
    }: {
      disabled: () => readonly string[]
      auth?: { store: McpAuthStore; redirectUrl: string }
    },
  ) {
    this.#disabled = disabled
    for (const [name, config] of Object.entries(configs)) {
      const ownAuth =
        config.type === 'remote' &&
        Object.keys(config.headers ?? {}).some(
          (header) => header.toLowerCase() === 'authorization',
        )
      this.#servers.set(name, {
        config,
        state: 'disabled',
        error: null,
        client: null,
        transport: null,
        tools: [],
        signIn:
          auth && config.type === 'remote' && !ownAuth
            ? new McpSignIn(name, auth.store, auth.redirectUrl)
            : null,
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
    const transport = transportFor(server.config, server.signIn)
    server.client = client
    server.transport = transport
    try {
      await client.connect(transport, {
        timeout: CONNECT_TIMEOUT[server.config.type],
      })
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
      // The sign-in flow has started: its URL is in `signIn`.
      if (err instanceof UnauthorizedError && server.signIn?.authorizationUrl) {
        server.state = 'needs-sign-in'
      } else {
        Object.assign(server, {
          state: 'failed',
          error: stderrOf(transport) ?? (err as Error).message,
        })
      }
    }
  }

  /**
   * Starts signing in to `name`: the provider's URL to send the browser to,
   * or `null` when it connected without one (e.g. its tokens were still
   * good). `returnTo` is where the callback sends the browser back.
   */
  async signIn(name: string, returnTo: string): Promise<URL | null> {
    const server = this.#get(name)
    if (!server.signIn) throw new Error(`${name} doesn’t use sign-in`)
    server.signIn.returnTo = returnTo
    await this.connect(name)
    if (server.state === 'failed') throw new Error(server.error!)
    return server.state === 'needs-sign-in'
      ? server.signIn.authorizationUrl
      : null
  }

  /**
   * Finishes a sign-in from the provider's redirect (`code`, `state`) and
   * connects. Returns where to send the browser back.
   *
   * @throws Error for a `state` chibot didn't hand out (or used already)
   */
  async finishSignIn(params: URLSearchParams): Promise<string> {
    // The SDK doesn't check `state`: it's what ties the redirect to a
    // sign-in started here, rather than one another site sent the browser.
    const found = [...this.#servers].find(([, s]) =>
      s.signIn?.takeState(params.get('state')),
    )
    if (!found) throw new Error('This sign-in is unknown or was used already')
    const [name, server] = found
    const signIn = server.signIn!
    if (params.has('error')) {
      // The provider's text is the redirect's, so it isn't shown.
      Object.assign(server, {
        state: 'failed',
        error: 'Sign-in was cancelled or refused',
      })
      return signIn.returnTo
    }
    try {
      const url = new URL((server.config as { url: string }).url)
      await new StreamableHTTPClientTransport(url, {
        authProvider: signIn,
      }).finishAuth(params)
    } catch (err) {
      Object.assign(server, {
        state: 'failed',
        error: `Sign-in failed: ${(err as Error).message}`,
      })
      return signIn.returnTo
    }
    await this.connect(name)
    return signIn.returnTo
  }

  /** Forgets `name`'s sign-in; it then needs signing in again. */
  async signOut(name: string): Promise<void> {
    const server = this.#get(name)
    if (!server.signIn) throw new Error(`${name} doesn’t use sign-in`)
    server.signIn.signOut()
    await this.disconnect(name)
    if (!this.#disabled().includes(name)) await this.connect(name)
  }

  /** Disconnects `name` (a local server's process stops). */
  async disconnect(name: string): Promise<void> {
    const server = this.#get(name)
    await this.#close(server)
    Object.assign(server, { state: 'disabled', error: null, tools: [] })
  }

  has(name: string): boolean {
    return this.#servers.has(name)
  }

  statuses(): McpServerStatus[] {
    return [...this.#servers].map(([name, server]) => ({
      name,
      type: server.config.type,
      state: server.state,
      error: server.error,
      signedIn: server.signIn?.signedIn ?? null,
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

function transportFor(
  config: McpServerConfig,
  signIn: McpSignIn | null,
): Transport {
  if (config.type === 'remote') {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
      authProvider: signIn ?? undefined,
    })
  }
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    // Only the safe defaults (PATH, HOME, …): never chibot's own keys.
    env: { ...getDefaultEnvironment(), ...config.env },
    // Not chibot's folder: npx and npm read its package.json there, whose
    // devEngines (pnpm) makes them refuse to run.
    cwd: config.cwd ?? homedir(),
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
