import {
  type Client,
  StreamableHTTPClientTransport,
  type Tool as McpToolDefinition,
  type Transport,
} from '@modelcontextprotocol/client'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/client/stdio'
import { homedir } from 'node:os'
import type { McpSignIn } from './mcp-auth.ts'
import type { McpServerConfig } from './mcp-config.ts'

// How to reach an MCP server and what it lists: the parts of `McpServers`
// that need no state of its own.

// Function names: ^[A-Za-z0-9_-]{1,64}$.
const MAX_TOOL_NAME = 64

/** A tool a connected server offers, by the name the model calls it. */
export interface McpServerTool {
  name: string
  server: string
  definition: McpToolDefinition
}

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

export function sameConnection(
  a: McpServerConfig,
  b: McpServerConfig,
): boolean {
  const connection = (config: McpServerConfig) =>
    JSON.stringify(
      Object.entries(config).filter(([key]) => !SWITCHES.includes(key)),
    )
  return connection(a) === connection(b)
}

export function transportFor(
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
export async function listTools(
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

export function stderrOf(transport: Transport): string | null {
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
