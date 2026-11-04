import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import envPaths from 'env-paths'

/** The repo root: a checkout, or where a global `pnpm add -g .` links to. */
export const ROOT = join(import.meta.dirname, '../..')

export interface Locations {
  /** Holds `config.json` (secrets) and `mcp.json`. */
  configDir: string
  /** Holds the database, stored files and MCP sign-in tokens. */
  dataDir: string
  /** A standalone MCP file, used when `config.json` has no `mcpServers`. */
  mcpConfigPath: string
  /** `CHIBOT_MCP_CONFIG` names it: it is then used even if `config.json` has servers. */
  mcpConfigExplicit: boolean
  /** Older places still in use (checkout folders), for a note at startup. */
  legacy: string[]
}

/**
 * The XDG folders (`~/.config`, `~/.local/share`, or `XDG_CONFIG_HOME` and
 * `XDG_DATA_HOME`): where command-line tools keep their files on Linux, and
 * what developers expect on a Mac too, rather than `~/Library`.
 */
export function xdgPaths(
  home: string,
  env: Record<string, string | undefined>,
): { config: string; data: string } {
  return {
    config: join(env.XDG_CONFIG_HOME || join(home, '.config'), 'chibot'),
    data: join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'chibot'),
  }
}

/** The platform's folders: XDG on Linux and macOS, `env-paths`' on Windows. */
function platformPaths(): { config: string; data: string } {
  return process.platform === 'win32'
    ? envPaths('chibot', { suffix: '' })
    : xdgPaths(homedir(), process.env)
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
    paths = platformPaths(),
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
    // main.ts says so when that file is really the one used: config.json may have the servers.
    mcpConfigPath = join(root, 'mcp.json')
  }
  return {
    configDir,
    dataDir,
    mcpConfigPath,
    mcpConfigExplicit: Boolean(env.CHIBOT_MCP_CONFIG),
    legacy,
  }
}

/**
 * Those of `dirs` that other users of this machine can open (POSIX): chats and
 * keys are in them, and a database file is created readable by others unless
 * the folder holding it is not.
 */
export function openFolders(dirs: string[]): string[] {
  if (process.platform === 'win32') return []
  return dirs.filter((dir) => {
    try {
      return (statSync(dir).mode & 0o077) !== 0
    } catch {
      return false // not there yet
    }
  })
}
