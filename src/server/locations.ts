import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import envPaths from 'env-paths'

/** The repo root: a checkout, or where `pnpm link -g` points. */
export const ROOT = join(import.meta.dirname, '../..')

export interface Locations {
  /** Holds `config.json` (secrets) and `mcp.json`. */
  configDir: string
  /** Holds the database, stored files and MCP sign-in tokens. */
  dataDir: string
  mcpConfigPath: string
  /** Older places still in use (checkout folders), for a note at startup. */
  legacy: string[]
}

/** What decides where things live (`CHIBOT_*` in the environment). */
interface Overrides {
  CHIBOT_CONFIG_DIR?: string | undefined
  CHIBOT_DATA_DIR?: string | undefined
  CHIBOT_MCP_CONFIG?: string | undefined
}

/**
 * Where chibot keeps its files: the platform's own folders (see `env-paths`),
 * each overridable. A checkout used `<repo>/data` and `<repo>/mcp.json`; while
 * those exist and the new places hold nothing yet, they stay in use, so
 * upgrading never hides anyone's chats.
 */
export function locations(
  env: Overrides,
  {
    paths = envPaths('chibot', { suffix: '' }),
    root = ROOT,
    exists = existsSync,
  }: {
    paths?: { config: string; data: string }
    root?: string
    exists?: (path: string) => boolean
  } = {},
): Locations {
  const legacy: string[] = []
  const configDir = env.CHIBOT_CONFIG_DIR
    ? resolve(env.CHIBOT_CONFIG_DIR)
    : paths.config

  let dataDir = paths.data
  if (env.CHIBOT_DATA_DIR) {
    dataDir = resolve(env.CHIBOT_DATA_DIR)
  } else if (
    !exists(join(paths.data, 'chibot.db')) &&
    exists(join(root, 'data', 'chibot.db'))
  ) {
    dataDir = join(root, 'data')
    legacy.push(
      `Your chats are still in ${dataDir}. To use the standard place, move its contents to ${paths.data} while chibot is stopped.`,
    )
  }

  let mcpConfigPath = join(configDir, 'mcp.json')
  if (env.CHIBOT_MCP_CONFIG) {
    mcpConfigPath = resolve(env.CHIBOT_MCP_CONFIG)
  } else if (!exists(mcpConfigPath) && exists(join(root, 'mcp.json'))) {
    mcpConfigPath = join(root, 'mcp.json')
    legacy.push(
      `Your MCP servers are still in ${mcpConfigPath}. To use the standard place, move it to ${join(configDir, 'mcp.json')}.`,
    )
  }
  return { configDir, dataDir, mcpConfigPath, legacy }
}
