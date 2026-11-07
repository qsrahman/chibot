// How an MCP server is described in the config (`mcpServers`), shared so
// Settings can send the same shape the config file holds. The web imports the
// types only.
import { z } from 'zod'

/** Names prefix the servers' tool names (`<server>__<tool>`, ≤ 64). */
export const mcpServerName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,32}$/, 'use letters, digits, - and _ (at most 32)')

// What Settings → Tools switches, kept with the server: not connected, each
// call asking first, and tools (by the names the server gives them) off.
const switches = {
  disabled: z.boolean().optional(),
  ask: z.boolean().optional(),
  disabledTools: z.array(z.string()).optional(),
}

const localServer = z.strictObject({
  type: z.literal('local'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  ...switches,
})

const remoteServer = z.strictObject({
  type: z.literal('remote'),
  url: z.url({ protocol: /^https?$/ }),
  headers: z.record(z.string(), z.string()).optional(),
  ...switches,
})

/** `PATCH /api/mcp/servers/:name`: a switch of Settings → Tools, written to the config file. */
export const mcpSwitchSchema = z.object({
  /** On (`false`) or off (`true`) altogether. */
  disabled: z.boolean().optional(),
  /** Whether each call waits for Approve / Deny. */
  ask: z.boolean().optional(),
  /** One tool, by the name the server gives it (not `<server>__<tool>`). */
  tool: z.object({ name: z.string().min(1), enabled: z.boolean() }).optional(),
})
export type McpSwitch = z.infer<typeof mcpSwitchSchema>

export const mcpServerSchema = z.discriminatedUnion('type', [
  localServer,
  remoteServer,
])

export type McpServerConfig = z.output<typeof mcpServerSchema>

/**
 * `GET /api/mcp/definitions`: the servers as the config file holds them,
 * except that the values of `env` and `headers` are blank (they are keys, and
 * never leave the server). Sending a blank value back keeps the current one.
 */
export interface McpDefinitions {
  /** Whether Settings may change the servers; `reason` says why not. */
  editable: boolean
  reason: string | null
  /** The file they live in, e.g. `config.json`. */
  source: string
  servers: Record<string, McpServerConfig>
}

/** A server Settings offers to add: the user fills in what's blank. */
export interface McpPreset {
  id: string
  label: string
  description: string
  /** Suggested name. */
  name: string
  server: McpServerConfig
  /** What the user must supply (a folder, a key), shown under the form. */
  note?: string
}

/** Starting points for common servers (the user can change every field). */
export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'fetch',
    label: 'Web pages (fetch)',
    description: 'Reads a web page for the model. Needs uv (uvx).',
    name: 'fetch',
    server: { type: 'local', command: 'uvx', args: ['mcp-server-fetch'] },
  },
  {
    id: 'brave-search',
    label: 'Web search (Brave)',
    description: 'Searches the web with Brave Search. Needs Node (npx).',
    name: 'search',
    server: {
      type: 'local',
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server'],
      env: { BRAVE_API_KEY: '' },
    },
    note: 'Paste your Brave Search API key as the BRAVE_API_KEY value.',
  },
  {
    id: 'filesystem',
    label: 'Files in a folder',
    description: 'Lets the model read and write files in one folder.',
    name: 'files',
    server: {
      type: 'local',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', ''],
    },
    note: 'Replace the last argument with the folder to share, as a full path. Switch on “Ask before using its tools” so writes wait for your approval.',
  },
]
