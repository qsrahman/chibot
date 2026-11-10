import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { z } from 'zod'
import {
  mcpServerName,
  mcpServerSchema,
  type McpServerConfig,
} from '../../shared/mcp.ts'
import { errorMessage } from '../../shared/errors.ts'

// Servers are only ever set up by the owner: a `local` server is a command
// chibot runs with the owner's rights, and chibot has no login. (Settings may
// edit them only where `McpServerFile` allows.)

const mcpConfigSchema = z.strictObject({
  mcpServers: z.record(mcpServerName, mcpServerSchema),
})

export type { McpServerConfig }

/**
 * The MCP servers in `path` (none when there's no file), with `${VAR}`
 * filled from `env` so secrets stay out of the file.
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
    throw new Error(`${basename(path)}: ${errorMessage(err)}`)
  }
  return parseMcpConfig(json, env, basename(path))
}

/**
 * The servers in `json` (`{ "mcpServers": { … } }`, from a file or from
 * `config.json`), with `${VAR}` filled from `env`. `source` names it in errors.
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
    return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
      const filled = env[name]
      if (filled === undefined) {
        throw new Error(
          `${source} uses \${${name}}, which isn’t set: export it, or run chibot config set env.${name} <value>`,
        )
      }
      return filled
    })
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
