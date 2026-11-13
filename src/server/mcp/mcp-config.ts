import { z } from 'zod'
import {
  mcpServerName,
  mcpServerSchema,
  type McpServerConfig,
} from '../../shared/mcp.ts'

// Servers are only ever set up by the owner: a `local` server is a command
// chibot runs with the owner's rights, and chibot has no login. (Settings may
// edit them only where `McpServerFile` allows.)

const mcpConfigSchema = z.strictObject({
  mcpServers: z.record(mcpServerName, mcpServerSchema),
})

export type { McpServerConfig }

/**
 * The servers in `json` (`{ "mcpServers": { … } }`, from `config.json`), with `${VAR}` filled from `env`. `source` names it in errors.
 *
 * @throws Error saying what's wrong (the server and field)
 */
export function parseMcpConfig(
  json: unknown,
  env: NodeJS.ProcessEnv,
  source: string,
): Record<string, McpServerConfig> {
  const parsed = mcpConfigSchema.safeParse(fill(json, env, source))
  if (!parsed.success) {
    throw new Error(`${source}:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data.mcpServers
}

/** Every string in `value` with `${VAR}` replaced from `env`. */
function fill(value: unknown, env: NodeJS.ProcessEnv, source: string): unknown {
  if (typeof value === 'string') {
    // `${NAME}`, or `${NAME:-default}` for a variable that may be missing (an
    // empty one counts as set).
    return value.replace(
      /\$\{(\w+)(?::-([^}]*))?\}/g,
      (_, name: string, fallback?: string) => {
        const filled = env[name] ?? fallback
        if (filled === undefined) {
          throw new Error(
            `${source} uses \${${name}}, which isn’t set: export it, or run chibot config set env.${name} <value>`,
          )
        }
        return filled
      },
    )
  }
  if (Array.isArray(value))
    return value.map((entry) => fill(entry, env, source))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        fill(entry, env, source),
      ]),
    )
  }
  return value
}
