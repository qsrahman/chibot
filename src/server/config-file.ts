import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { errorMessage } from '../shared/errors.ts'

// `config.json`: the settings that used to live in `.env`, kept in chibot's
// config folder with mode 0600. It holds secrets, so it never goes into the
// database, an export or an API response (PLAN.md §6). Real environment
// variables still win over it, so a deployment can override a value.

const text = z.string().trim().min(1)
// A server's address: refused when set if it is not one, not at startup.
const address = z.url({
  protocol: /^https?$/,
  error: 'must be an http(s) address',
})
const endpoint = z
  .object({
    baseURL: address.optional(),
    apiKey: text.optional(),
    model: text.optional(),
  })
  .strict()

export const configFileSchema = z
  .object({
    /** Chat; also what the other features use for what they don't set. */
    chat: endpoint.optional(),
    image: endpoint.optional(),
    embedding: endpoint.optional(),
    rerank: endpoint.optional(),
    transcription: endpoint.optional(),
    server: z
      .object({
        host: text.optional(),
        port: z.number().int().min(1).max(65535).optional(),
      })
      .strict()
      .optional(),
    /** Required to use chibot (once per browser). */
    token: z
      .string()
      .trim()
      .min(16, 'must be at least 16 characters (e.g. `openssl rand -hex 16`)')
      .optional(),
    /**
     * MCP servers, in the usual `mcpServers` shape. Checked when they are
     * loaded, not here, so a mistake in one never stops chibot starting.
     */
    mcpServers: z.record(z.string(), z.unknown()).optional(),
    /**
     * chibot's own tools switched off in Settings → Tools (by name, as the
     * tools list gives them). Absent when none is. Read again at each use,
     * so a hand edit applies without a restart.
     */
    disabledTools: z.array(z.string()).optional(),
    /**
     * Variables for `${NAME}` in the MCP servers, below the real environment,
     * so a server's secret needs no place of its own. They reach nothing else:
     * not chibot's settings, and not the servers unless a value is passed on.
     */
    env: z
      .record(z.string().regex(/^\w+$/, 'letters, digits and _'), z.string())
      .optional(),
  })
  .strict()

export type ConfigFile = z.infer<typeof configFileSchema>

export const CONFIG_FILE = 'config.json'

/** Each setting's place in the file, and the environment variable that overrides it. */
const SETTINGS: [path: string, variable: string][] = [
  ['chat.baseURL', 'OPENAI_BASE_URL'],
  ['chat.apiKey', 'OPENAI_API_KEY'],
  ['chat.model', 'OPENAI_MODEL'],
  ['image.baseURL', 'OPENAI_IMAGE_BASE_URL'],
  ['image.apiKey', 'OPENAI_IMAGE_API_KEY'],
  ['image.model', 'OPENAI_IMAGE_MODEL'],
  ['embedding.baseURL', 'OPENAI_EMBEDDING_BASE_URL'],
  ['embedding.apiKey', 'OPENAI_EMBEDDING_API_KEY'],
  ['embedding.model', 'OPENAI_EMBEDDING_MODEL'],
  ['rerank.baseURL', 'OPENAI_RERANK_BASE_URL'],
  ['rerank.apiKey', 'OPENAI_RERANK_API_KEY'],
  ['rerank.model', 'OPENAI_RERANK_MODEL'],
  ['transcription.baseURL', 'OPENAI_TRANSCRIBE_BASE_URL'],
  ['transcription.apiKey', 'OPENAI_TRANSCRIBE_API_KEY'],
  ['transcription.model', 'OPENAI_TRANSCRIBE_MODEL'],
  ['server.host', 'HOST'],
  ['server.port', 'PORT'],
  ['token', 'CHIBOT_TOKEN'],
]

/** The setting (`chat.apiKey`) that the environment variable `variable` stands for, if any. */
export function settingOf(variable: string): string | undefined {
  return SETTINGS.find(([, name]) => name === variable)?.[0]
}

/** What is secret: shown as "set", never printed (all of `env`; `mcpServers` is listed by name). */
const SECRETS = /(^|\.)(apiKey|token)$|^env\./

function get(object: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value as Record<string, unknown> | undefined)?.[key],
      object,
    )
}

/** The file as environment variables, which `Config` reads. */
export function toEnv(file: ConfigFile): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [path, variable] of SETTINGS) {
    const value = get(file, path)
    if (value !== undefined) env[variable] = String(value)
  }
  return env
}

function setPath(
  object: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const keys = path.split('.')
  const last = keys.pop()!
  let at = object
  for (const key of keys) {
    at = (at[key] ??= {}) as Record<string, unknown>
  }
  at[last] = value
}

/** Read from `dir`; `exists` is false (and the file empty) when there is none. */
export function readConfigFile(dir: string): {
  file: ConfigFile
  path: string
  exists: boolean
  /** Readable by others (POSIX), which it shouldn't be. */
  tooOpen: boolean
} {
  const path = join(dir, CONFIG_FILE)
  if (!existsSync(path)) {
    return { file: {}, path, exists: false, tooOpen: false }
  }
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`${path} isn't valid JSON: ${errorMessage(err)}`)
  }
  const parsed = configFileSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`${path} has a problem:\n${z.prettifyError(parsed.error)}`)
  }
  const tooOpen =
    process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0
  return { file: parsed.data, path, exists: true, tooOpen }
}

/** Saves `file` to `dir` readable by the owner only, replacing it whole or not at all. */
export function writeConfigFile(dir: string, file: ConfigFile): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, CONFIG_FILE)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, {
    mode: 0o600,
  })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  return path
}

/**
 * `file` with the setting at `path` (`chat.model`) changed to `value`; an empty
 * value removes it. Unknown settings and invalid values throw.
 */
export function withSetting(
  file: ConfigFile,
  path: string,
  value: string,
): ConfigFile {
  // `env.NAME`: a variable for the MCP servers, named freely.
  const variable = /^env\.(.+)$/.exec(path)?.[1]
  if (variable !== undefined) {
    const env = { ...file.env }
    if (value === '') delete env[variable]
    else env[variable] = value
    const parsed = configFileSchema.safeParse({
      ...file,
      env: Object.keys(env).length > 0 ? env : undefined,
    })
    if (!parsed.success) {
      throw new Error(`Invalid ${path}:\n${z.prettifyError(parsed.error)}`)
    }
    return parsed.data
  }
  if (path === 'mcpServers' || path.startsWith('mcpServers.')) {
    throw new Error(
      'MCP servers are edited in config.json itself (`chibot config path` shows where): add them under "mcpServers", in the usual shape.',
    )
  }
  if (!SETTINGS.some(([known]) => known === path)) {
    throw new Error(
      `Unknown setting "${path}". Settings: ${SETTINGS.map(([p]) => p).join(', ')}, env.<NAME>`,
    )
  }
  const next = structuredClone(file) as Record<string, unknown>
  const keys = path.split('.')
  const last = keys.pop()!
  const parents: Record<string, unknown>[] = [next]
  for (const key of keys) {
    parents.push((parents.at(-1)![key] ??= {}) as Record<string, unknown>)
  }
  const holder = parents.at(-1)!
  if (value === '') delete holder[last]
  else holder[last] = path === 'server.port' ? Number(value) : value
  // Sections left empty go.
  for (let i = keys.length - 1; i >= 0; i--) {
    if (Object.keys(parents[i + 1]!).length === 0) delete parents[i]![keys[i]!]
  }
  const parsed = configFileSchema.safeParse(next)
  if (!parsed.success) {
    throw new Error(
      `Invalid value for ${path}:\n${z.prettifyError(parsed.error)}`,
    )
  }
  return parsed.data
}

/** The `mcpServers` of a standalone `mcp.json`, or `null` if it has none (or isn't JSON). */
export function readMcpServers(path: string): Record<string, unknown> | null {
  try {
    const json = JSON.parse(readFileSync(path, 'utf8')) as {
      mcpServers?: unknown
    } | null
    const servers = json?.mcpServers
    return servers && typeof servers === 'object' && !Array.isArray(servers)
      ? (servers as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * What `${NAME}` in the MCP servers is filled from: the real environment, over the
 * `env` of `config.json` (read afresh, so Reload sees a change).
 */
export function mcpVariables(dir: string): NodeJS.ProcessEnv {
  return { ...readConfigFile(dir).file.env, ...process.env }
}

/** `file` for printing: secrets show as "set". */
export function redacted(file: ConfigFile): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [path] of SETTINGS) {
    const value = get(file, path)
    if (value !== undefined)
      setPath(out, path, SECRETS.test(path) ? 'set' : value)
  }
  // Which servers and variables exist, not their commands, headers or values.
  if (file.mcpServers) {
    out.mcpServers = Object.fromEntries(
      Object.keys(file.mcpServers).map((name) => [name, 'set']),
    )
  }
  if (file.env) {
    out.env = Object.fromEntries(
      Object.keys(file.env).map((name) => [name, 'set']),
    )
  }
  return out
}

/**
 * The tools switched off in `dir`'s config file, or `null` when the file has
 * none (or can't be read just now, e.g. mid-edit).
 */
export function readDisabledTools(dir: string): string[] | null {
  try {
    return readConfigFile(dir).file.disabledTools ?? null
  } catch {
    return null
  }
}

/** Saves the tools switched off (none: the key is left out, as a default is). */
export function writeDisabledTools(dir: string, tools: string[]): void {
  const { file } = readConfigFile(dir)
  const { disabledTools: _, ...rest } = file
  writeConfigFile(
    dir,
    tools.length > 0 ? { ...rest, disabledTools: tools } : rest,
  )
}
