// How an MCP server is described in the config (`mcpServers`), shared so
// Settings can send the same shape the config file holds. The web imports the
// types only.
import { z } from 'zod'

/** Names prefix the servers' tool names (`<server>__<tool>`, ≤ 64). */
export const mcpServerName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,32}$/, 'use letters, digits, - and _ (at most 32)')

// What Settings → Tools switches, kept with the server: connected or not (on
// unless `enabled` is false), each call asking first, and tools (by the names
// the server gives them) off.
const switches = {
  enabled: z.boolean().optional(),
  /** Seconds a server gets to start (a first `npx -y` may download); 60 by default for a local one, 10 for a remote one. */
  startupTimeoutSec: z.number().int().min(1).max(600).optional(),
  /** Give the model what the server says about using its tools (its `instructions`), cut to 2,000 characters. */
  instructions: z.boolean().optional(),
  /** Seconds a call may go without an answer or a progress report (60 by default). */
  toolTimeoutSec: z.number().int().min(1).max(3600).optional(),
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
  /** On or off altogether. */
  enabled: z.boolean().optional(),
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
