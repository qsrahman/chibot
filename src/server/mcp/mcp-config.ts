import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { z } from 'zod'

// Servers are only ever set up here, by the owner: a `local` server is a
// command chibot runs with the owner's rights, and chibot has no login.

/** Names prefix the servers' tool names (`<server>__<tool>`, ≤ 64). */
const serverName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,32}$/, 'use letters, digits, - and _ (at most 32)')

const localServer = z.strictObject({
  type: z.literal('local'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
})

const remoteServer = z.strictObject({
  type: z.literal('remote'),
  url: z.url({ protocol: /^https?$/ }),
  headers: z.record(z.string(), z.string()).optional(),
})

const mcpConfigSchema = z.strictObject({
  mcpServers: z.record(
    serverName,
    z.discriminatedUnion('type', [localServer, remoteServer]),
  ),
})

export type McpServerConfig = z.output<typeof localServer | typeof remoteServer>

/**
 * The MCP servers in `path` (none when there's no file), with `${VAR}`
 * filled from `env` so secrets can stay in `.env`.
 *
 * @throws Error saying what's wrong (the server and field)
 */
export function loadMcpConfig(
  path: string,
  env: NodeJS.ProcessEnv,
): Record<string, McpServerConfig> {
  if (!existsSync(path)) return {}
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`${basename(path)}: ${(err as Error).message}`)
  }
  const parsed = mcpConfigSchema.safeParse(fill(json, env))
  if (!parsed.success) {
    throw new Error(`${basename(path)}:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data.mcpServers
}

/** Every string in `value` with `${VAR}` replaced from `env`. */
function fill(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
      const filled = env[name]
      if (filled === undefined) {
        throw new Error(`mcp.json uses \${${name}}, which isn’t set`)
      }
      return filled
    })
  }
  if (Array.isArray(value)) return value.map((entry) => fill(entry, env))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, fill(entry, env)]),
    )
  }
  return value
}
