import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import envPaths from 'env-paths'

/** The repo root: a checkout, or where a global `pnpm add -g .` links to. */
export const ROOT = join(import.meta.dirname, '../..')

export interface Locations {
  /** Holds `config.json` (secrets). */
  configDir: string
  /** Holds the database, stored files and MCP sign-in tokens. */
  dataDir: string
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
}

/**
 * Where chibot keeps its files: the platform's own folders (see `env-paths`),
 * each overridable.
 */
export function locations(
  env: Overrides,
  {
    paths = platformPaths(),
  }: { paths?: { config: string; data: string } } = {},
): Locations {
  return {
    configDir: env.CHIBOT_CONFIG_DIR
      ? resolve(env.CHIBOT_CONFIG_DIR)
      : paths.config,
    dataDir: env.CHIBOT_DATA_DIR ? resolve(env.CHIBOT_DATA_DIR) : paths.data,
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
