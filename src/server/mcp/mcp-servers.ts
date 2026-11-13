import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type ReadResourceResult,
  type Resource,
  type ResourceTemplateType,
  type Tool as McpToolDefinition,
  type Transport,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/client/stdio'
import { homedir } from 'node:os'
import type { McpServerStatus } from '../../shared/types.ts'
import { McpSignIn, type McpAuthStore } from './mcp-auth.ts'
import type { McpServerConfig } from './mcp-config.ts'
import { errorMessage } from '../../shared/errors.ts'

// A local server may first have to download itself (`npx -y …`). Both can be
// set per server (`startupTimeoutSec`, `toolTimeoutSec`).
const CONNECT_TIMEOUT = { local: 60_000, remote: 10_000 }
const CALL_TIMEOUT = 60_000
// A call that keeps reporting progress may outlast its timeout, but not this.
const CALL_LIMIT = 30 * 60_000
// A server that was connected and then stopped (a crash, a dropped
// connection) is started again after each of these waits, and then given up on.
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16_000]
// A connection that lasted this long was a working one: the next drop starts
// the counting again.
const STABLE_FOR = 60_000
// Function names: ^[A-Za-z0-9_-]{1,64}$.
const MAX_TOOL_NAME = 64

/** What one server offers to read, for `list_mcp_resources`. */
export interface McpResources {
  server: string
  resources: Resource[]
  templates: ResourceTemplateType[]
  /** Why its list could not be had. */
  error?: string
}

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
  /** Starts again after a drop: how many so far, and the wait for the next. */
  retries: number
  /** What the server said about using its tools when it connected. */
  instructions: string | null
  /** Whether it offers resources (files, documents, records to read). */
  resources: boolean
  retryTimer: ReturnType<typeof setTimeout> | null
  connectedAt: number
}

/**
 * The MCP servers from the config: connects the enabled ones, keeps their
 * status and tool lists current, and calls their tools.
 */
export class McpServers {
  readonly #servers = new Map<string, Server>()
  readonly #load: (() => Record<string, McpServerConfig>) | undefined
  readonly #auth: { store: McpAuthStore; redirectUrl: string } | undefined
  readonly #retryDelays: readonly number[]

  /**
   * @param options.auth where remote servers' sign-ins are kept, and the
   *   OAuth callback's URL; without it they can't sign in
   * @param options.load reads the servers again for `reload()`
   * @param options.retryDelays the waits before starting a dropped server
   *   again (milliseconds; tests make them short)
   */
  constructor(
    configs: Record<string, McpServerConfig>,
    {
      auth,
      load,
      retryDelays = RETRY_DELAYS,
    }: {
      auth?: { store: McpAuthStore; redirectUrl: string }
      load?: () => Record<string, McpServerConfig>
      retryDelays?: readonly number[]
    } = {},
  ) {
    this.#retryDelays = retryDelays
    this.#auth = auth
    this.#load = load
    for (const [name, config] of Object.entries(configs)) {
      this.#servers.set(name, this.#create(name, config))
    }
  }

  #create(name: string, config: McpServerConfig): Server {
    const ownAuth =
      config.type === 'remote' &&
      Object.keys(config.headers ?? {}).some(
        (header) => header.toLowerCase() === 'authorization',
      )
    return {
      config,
      state: 'disabled',
      error: null,
      client: null,
      transport: null,
      tools: [],
      signIn:
        this.#auth && config.type === 'remote' && !ownAuth
          ? new McpSignIn(name, this.#auth.store, this.#auth.redirectUrl)
          : null,
      retries: 0,
      instructions: null,
      resources: false,
      retryTimer: null,
      connectedAt: 0,
    }
  }

  /**
   * Reads the servers again: new ones connect, removed ones stop, and ones
   * whose settings changed restart. Untouched servers stay connected, and so
   * do ones whose switches (on or off, asking, tools) are all that changed.
   *
   * @throws Error if the file is invalid (nothing then changes)
   */
  async reload(): Promise<void> {
    if (!this.#load) throw new Error('This server has no config to reload')
    const configs = this.#load()
    for (const [name, server] of [...this.#servers]) {
      const config = configs[name]
      if (config && sameConnection(config, server.config)) {
        // Only a switch changed (or nothing): no reason to reconnect.
        server.config = config
        continue
      }
      await this.#close(server)
      this.#servers.delete(name)
    }
    for (const [name, config] of Object.entries(configs)) {
      if (!this.#servers.has(name)) {
        this.#servers.set(name, this.#create(name, config))
      }
    }
    await this.sync()
  }

  /** Connects every enabled server, in parallel; failures are recorded. */
  start(): Promise<void> {
    return this.sync()
  }

  /** Connects servers switched on and disconnects those switched off. */
  async sync(): Promise<void> {
    await Promise.all(
      [...this.#servers].map(([name, server]) => {
        if (isOff(server)) {
          return server.state === 'disabled' ? null : this.disconnect(name)
        }
        return server.state === 'disabled' ? this.connect(name) : null
      }),
    )
  }

  /** (Re)connects `name`, e.g. after it failed. */
  async connect(name: string): Promise<void> {
    const server = this.#get(name)
    server.retries = 0
    await this.#connect(name, server)
  }

  /** `automatic`: started again after a drop, so a failure goes on to the next try. */
  async #connect(
    name: string,
    server: Server,
    automatic = false,
  ): Promise<void> {
    await this.#close(server)
    Object.assign(server, { state: 'connecting', error: null, tools: [] })
    const client = new Client({ name: 'chibot', version: '1' })
    const transport = transportFor(server.config, server.signIn)
    server.client = client
    server.transport = transport
    try {
      await client.connect(transport, {
        timeout:
          (server.config.startupTimeoutSec ?? 0) * 1000 ||
          CONNECT_TIMEOUT[server.config.type],
      })
      client.setNotificationHandler(
        'notifications/tools/list_changed',
        async () => {
          if (server.client !== client) return
          // A refresh that fails keeps the list the server gave before.
          try {
            server.tools = await listTools(name, client)
          } catch (err) {
            console.warn(
              `MCP server ${name}: could not refresh its tools: ${errorMessage(err)}`,
            )
          }
        },
      )
      server.tools = await listTools(name, client)
      server.instructions = client.getInstructions()?.trim() || null
      server.resources = client.getServerCapabilities()?.resources !== undefined
      server.state = 'connected'
      server.connectedAt = Date.now()
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
        if (Date.now() - server.connectedAt >= STABLE_FOR) server.retries = 0
        this.#retry(name, server)
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
          error: stderrOf(transport) ?? errorMessage(err),
        })
        if (automatic) this.#retry(name, server)
      }
    }
  }

  /** Starts a server that stopped again after a wait, a few times, saying so in its status. */
  #retry(name: string, server: Server): void {
    if (isOff(server) || this.#servers.get(name) !== server) return
    const delay = this.#retryDelays[server.retries]
    const reason = server.error ?? 'The server stopped'
    if (delay === undefined) {
      server.error = `${reason}\n(Gave up starting it again; Reconnect tries once more.)`
      return
    }
    server.retries++
    server.error = `${reason}\n(Starting it again in ${delay / 1000} s, try ${server.retries} of ${this.#retryDelays.length}.)`
    server.retryTimer = setTimeout(() => {
      server.retryTimer = null
      if (server.state === 'failed' && this.#servers.get(name) === server) {
        void this.#connect(name, server, true)
      }
    }, delay)
    server.retryTimer.unref()
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
        error: `Sign-in failed: ${errorMessage(err)}`,
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
    if (!isOff(server)) await this.connect(name)
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
      ask: this.asks(name),
      tools: server.tools.map((tool) => ({
        name: tool.name,
        title:
          tool.definition.title ??
          tool.definition.annotations?.title ??
          tool.definition.name,
        description: tool.definition.description ?? '',
        enabled: !this.#toolOff(server, tool),
      })),
    }))
  }

  /** Whether calls to `name`'s tools wait for the user's approval. */
  asks(name: string): boolean {
    return this.#servers.get(name)?.config.ask === true
  }

  /**
   * What the connected server `name` says about using its tools, if its entry
   * asks for it (`instructions: true`): a server can write anything there, and
   * every request would carry it.
   */
  instructionsOf(name: string): string | null {
    const server = this.#servers.get(name)
    return server?.state === 'connected' && server.config.instructions
      ? server.instructions
      : null
  }

  /** Whether the tool the model knows as `toolName` is switched off. */
  toolOff(toolName: string): boolean {
    for (const server of this.#servers.values()) {
      const tool = server.tools.find((t) => t.name === toolName)
      if (tool) return this.#toolOff(server, tool)
    }
    return false
  }

  #toolOff(server: Server, tool: McpServerTool): boolean {
    return (server.config.disabledTools ?? []).includes(tool.definition.name)
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
      {
        signal,
        timeout: callTimeout(this.#get(tool.server).config),
        // A tool that reports progress is working: the timeout starts again.
        onprogress: () => {},
        resetTimeoutOnProgress: true,
        maxTotalTimeout: CALL_LIMIT,
      },
    ) as Promise<CallToolResult>
  }

  /** The connected servers that offer resources. */
  resourceServers(): string[] {
    return [...this.#servers]
      .filter(([, server]) => server.state === 'connected' && server.resources)
      .map(([name]) => name)
  }

  /**
   * The resources and resource templates of `only` (a server's name) or of
   * every server that offers them; a server that fails to answer is reported
   * in its `error` and leaves the others out of it.
   *
   * @throws Error if `only` offers no resources
   */
  async listResources(
    only: string | null,
    signal?: AbortSignal,
  ): Promise<McpResources[]> {
    const names = this.resourceServers().filter(
      (name) => only === null || name === only,
    )
    if (only !== null && names.length === 0) throw this.#noResources(only)
    return Promise.all(
      names.map(async (name): Promise<McpResources> => {
        const { client, config } = this.#get(name)
        const options = { signal, timeout: callTimeout(config) }
        try {
          const [resources, templates] = await Promise.all([
            client!.listResources(undefined, options),
            // Some servers have resources but no templates.
            client!.listResourceTemplates(undefined, options).catch(() => ({
              resourceTemplates: [],
            })),
          ])
          return {
            server: name,
            resources: resources.resources,
            templates: templates.resourceTemplates,
          }
        } catch (err) {
          return {
            server: name,
            resources: [],
            templates: [],
            error: errorMessage(err),
          }
        }
      }),
    )
  }

  /**
   * What `uri` holds on `server`.
   *
   * @throws Error if the server offers no resources, or has no such one
   */
  async readResource(
    name: string,
    uri: string,
    signal?: AbortSignal,
  ): Promise<ReadResourceResult['contents']> {
    if (!this.resourceServers().includes(name)) throw this.#noResources(name)
    const { client, config } = this.#get(name)
    const result = await client!.readResource(
      { uri },
      { signal, timeout: callTimeout(config) },
    )
    return result.contents
  }

  #noResources(name: string): Error {
    const have = this.resourceServers()
    return new Error(
      `${name} offers no resources` +
        (have.length ? `; the servers that do are ${have.join(', ')}` : ''),
    )
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
    if (server.retryTimer) clearTimeout(server.retryTimer)
    server.retryTimer = null
    const { client } = server
    server.client = null
    server.transport = null
    await client?.close().catch(() => {})
  }
}

/** Whether two entries reach the same server the same way (the switches aside). */
const callTimeout = (config: McpServerConfig): number =>
  (config.toolTimeoutSec ?? 0) * 1000 || CALL_TIMEOUT

// What an entry holds beside how to reach the server: changing one needs no
// new connection.
const SWITCHES = [
  'enabled',
  'instructions',
  'ask',
  'disabledTools',
  'startupTimeoutSec',
  'toolTimeoutSec',
]

/** Whether a server's entry switches it off (`enabled: false`). */
const isOff = (server: Server): boolean => server.config.enabled === false

function sameConnection(a: McpServerConfig, b: McpServerConfig): boolean {
  const connection = (config: McpServerConfig) =>
    JSON.stringify(
      Object.entries(config).filter(([key]) => !SWITCHES.includes(key)),
    )
  return connection(a) === connection(b)
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

/**
 * All of a server's tools, named for the model. The SDK follows the pages
 * itself (and stops at its page limit, which a server that never ends its
 * list would otherwise outlast), and caches the list until the server says it
 * changed.
 */
async function listTools(
  server: string,
  client: Client,
): Promise<McpServerTool[]> {
  const { tools: definitions } = await client.listTools()
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
