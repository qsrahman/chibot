import {
  mcpServerName,
  mcpServerSchema,
  type McpDefinitions,
  type McpServerConfig,
  type McpSwitch,
} from '../../shared/mcp.ts'

/** What `McpServerFile` needs from the place the servers are kept. */
export interface McpServerStorage {
  /** The file's name, for messages. */
  source: string
  /** `null`: Settings may change the servers. Otherwise, why not. */
  locked: string | null
  /** The servers as written, `${VAR}` unfilled. */
  read: () => Record<string, unknown>
  write: (servers: Record<string, unknown>) => void
  /** Throws, saying what's wrong, if `servers` can't be used. */
  check: (servers: Record<string, unknown>) => void
}

/**
 * Adds, changes and removes servers in the config file for Settings. Secrets
 * (`env` and `headers` values) are never read back out: `describe()` blanks
 * them, and a blank value in `put()` keeps the one in the file.
 */
export class McpServerFile {
  readonly #storage: McpServerStorage

  constructor(storage: McpServerStorage) {
    this.#storage = storage
  }

  describe(): McpDefinitions {
    const servers: Record<string, McpServerConfig> = {}
    for (const [name, raw] of Object.entries(this.#storage.read())) {
      // One that doesn't parse stays in the file, but can't be edited here.
      const parsed = mcpServerSchema.safeParse(raw)
      if (parsed.success) servers[name] = blanked(parsed.data)
    }
    return {
      editable: this.#storage.locked === null,
      reason: this.#storage.locked,
      source: this.#storage.source,
      servers,
    }
  }

  /**
   * Saves `server` as `name` (a new one, or a change).
   *
   * @throws Error saying what's wrong; the file is then unchanged
   */
  put(name: string, server: McpServerConfig): void {
    this.#unlocked()
    mcpServerName.parse(name)
    const servers = this.#storage.read()
    const current = mcpServerSchema.safeParse(servers[name])
    // The form doesn't show the switches: an edit leaves them as they were.
    servers[name] = {
      ...switchesOf(current.success ? current.data : null),
      ...withKept(server, current.success ? current.data : null),
    }
    this.#storage.check(servers)
    this.#storage.write(servers)
  }

  /**
   * Writes a switch of Settings → Tools into the server's entry: off, asking
   * first, or one tool off (an entry holds only what is not the default). Not
   * behind the lock that adding a server has: nothing here runs a command.
   *
   * @throws Error if there is no such server
   */
  setSwitch(name: string, change: McpSwitch): void {
    const servers = this.#storage.read()
    const current = servers[name]
    if (!current || typeof current !== 'object') {
      throw new Error(`No MCP server named ${name}`)
    }
    const entry: Record<string, unknown> = { ...current }
    if (change.enabled !== undefined) {
      // On is the default, so an entry holds only `enabled: false`.
      if (change.enabled) delete entry.enabled
      else entry.enabled = false
    }
    if (change.ask !== undefined) {
      if (change.ask) entry.ask = true
      else delete entry.ask
    }
    if (change.tool) {
      const off = new Set((entry.disabledTools as string[] | undefined) ?? [])
      if (change.tool.enabled) off.delete(change.tool.name)
      else off.add(change.tool.name)
      if (off.size > 0) entry.disabledTools = [...off]
      else delete entry.disabledTools
    }
    // Only this entry's shape: another server's trouble shouldn't stop a switch.
    mcpServerSchema.parse(entry)
    servers[name] = entry
    this.#storage.write(servers)
  }

  /** @throws Error if there is no such server or the file is locked */
  remove(name: string): void {
    this.#unlocked()
    const servers = this.#storage.read()
    if (!(name in servers)) throw new Error(`No MCP server named ${name}`)
    delete servers[name]
    this.#storage.write(servers)
  }

  #unlocked() {
    if (this.#storage.locked) throw new Error(this.#storage.locked)
  }
}

/** The switches of an entry (see `mcpServerSchema`), to carry over an edit. */
function switchesOf(server: McpServerConfig | null) {
  if (!server) return {}
  const {
    enabled,
    ask,
    disabledTools,
    instructions,
    startupTimeoutSec,
    toolTimeoutSec,
  } = server
  return {
    ...(enabled !== undefined && { enabled }),
    ...(instructions !== undefined && { instructions }),
    ...(startupTimeoutSec !== undefined && { startupTimeoutSec }),
    ...(toolTimeoutSec !== undefined && { toolTimeoutSec }),
    ...(ask !== undefined && { ask }),
    ...(disabledTools !== undefined && { disabledTools }),
  }
}

const blankValues = (values: Record<string, string> | undefined) =>
  values && Object.fromEntries(Object.keys(values).map((key) => [key, '']))

function blanked(server: McpServerConfig): McpServerConfig {
  return server.type === 'local'
    ? { ...server, ...(server.env && { env: blankValues(server.env) }) }
    : {
        ...server,
        ...(server.headers && { headers: blankValues(server.headers) }),
      }
}

/** `server` with each blank secret replaced by the value `current` has for it. */
function withKept(
  server: McpServerConfig,
  current: McpServerConfig | null,
): McpServerConfig {
  const fill = (
    label: string,
    values: Record<string, string> | undefined,
    kept: Record<string, string> | undefined,
  ) => {
    if (!values) return undefined
    return Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        const keep = value === '' ? kept?.[key] : value
        if (keep === undefined) throw new Error(`${label} ${key} needs a value`)
        return [key, keep]
      }),
    )
  }
  if (server.type === 'local') {
    const env = fill(
      'Environment variable',
      server.env,
      current?.type === 'local' ? current.env : undefined,
    )
    return { ...server, ...(env && { env }) }
  }
  const headers = fill(
    'Header',
    server.headers,
    current?.type === 'remote' ? current.headers : undefined,
  )
  return { ...server, ...(headers && { headers }) }
}
