import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import type { ChatModel } from 'openai/resources/shared'
import { settingOf, toEnv, type ConfigFile } from './config-file.ts'
import { locations, ROOT } from './locations.ts'
import { z } from 'zod'

/**
 * The settings in the repo's `.env`, which older versions used for all of
 * them. They count for less than `config.json` (they are what `chibot init`
 * moves into it, and a leftover file must not override a later `chibot config
 * set`), and for less than the real environment. Read, not loaded into
 * `process.env`, so nothing else sees them as the real environment either.
 * The current folder's `.env` is not read: a global command would otherwise
 * take whatever keys the folder it runs in happens to hold, and a hostile
 * folder could point it at its own server.
 *
 * @returns the values, and the files they came from
 */
export function readEnvFiles(paths = [join(ROOT, '.env')]): {
  values: Record<string, string>
  files: string[]
} {
  const values: Record<string, string> = {}
  const files: string[] = []
  // The first file wins, as with the real environment over a file.
  for (const path of [...new Set(paths)].reverse()) {
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch (err) {
      // A missing file is fine: variables may come from elsewhere.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
    Object.assign(values, parseEnv(text))
    files.unshift(path)
  }
  return { values, files }
}

/**
 * The settings from every place, lowest first: an old `.env`, `config.json`,
 * the real environment, then the command line (`flags`, as variables).
 */
export function layered({
  legacy,
  file,
  env,
  flags,
}: {
  legacy: Record<string, string>
  file: ConfigFile
  env: NodeJS.ProcessEnv
  flags: Record<string, string>
}): NodeJS.ProcessEnv {
  return { ...legacy, ...toEnv(file), ...env, ...flags }
}

/** Connection to an OpenAI or OpenAI-compatible (Responses API) server. */
export interface Endpoint {
  /** `undefined` means the SDK's default (OpenAI). */
  baseURL: string | undefined
  apiKey: string
  /** `''` for a feature's endpoint with no model named: it can be set in Settings. */
  model: string
}

/**
 * The chat model on OpenAI when `OPENAI_MODEL` isn't set. The SDK has no
 * default of its own at runtime (a request has to name a model), only this
 * type listing its models, newest first; typing the name with it makes a
 * future SDK that drops or renames it fail the typecheck.
 */
const OPENAI_DEFAULT_MODEL: ChatModel = 'gpt-6-astra'

/** Unset and blank (`FOO=`) both mean "not set". */
const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)

const envSchema = z
  .object({
    OPENAI_BASE_URL: optional,
    OPENAI_API_KEY: optional,
    OPENAI_MODEL: optional,
    OPENAI_IMAGE_BASE_URL: optional,
    OPENAI_IMAGE_API_KEY: optional,
    OPENAI_IMAGE_MODEL: optional,
    OPENAI_EMBEDDING_BASE_URL: optional,
    OPENAI_EMBEDDING_API_KEY: optional,
    OPENAI_EMBEDDING_MODEL: optional,
    OPENAI_TRANSCRIBE_BASE_URL: optional,
    OPENAI_TRANSCRIBE_API_KEY: optional,
    OPENAI_TRANSCRIBE_MODEL: optional,
    // Loopback by default: the app has no auth and spends the owner's API key.
    HOST: optional.transform((host) => host ?? '127.0.0.1'),
    PORT: optional
      .transform((port) => port ?? '3000')
      .pipe(
        z.coerce
          .number<string>()
          .int('must be an integer')
          .min(1, 'must be in 1-65535')
          .max(65535, 'must be in 1-65535'),
      ),
    CHIBOT_CONFIG_DIR: optional,
    CHIBOT_DATA_DIR: optional,
    // Required to use chibot (once per browser), e.g. when HOST exposes it.
    CHIBOT_MCP_CONFIG: optional,
    CHIBOT_TOKEN: optional.refine(
      (token) => token === undefined || token.length >= 16,
      'must be at least 16 characters (e.g. `openssl rand -hex 16`)',
    ),
  })
  .superRefine((env, ctx) => {
    if (!env.OPENAI_API_KEY && !env.OPENAI_BASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'is not set (run `chibot init`, or set it in the environment)',
      })
    }
    if (!env.OPENAI_MODEL && env.OPENAI_BASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_MODEL'],
        message: 'is required when OPENAI_BASE_URL is set',
      })
    }
  })

/** Typed, validated settings read from environment variables. */
export class Config {
  readonly chat: Endpoint
  /** Image generation, or `null` without a server or key to use. */
  readonly image: Endpoint | null
  /** Project file embeddings, or `null`: then search is by keywords only. */
  readonly embedding: Endpoint | null
  /** Voice input, or `null`: then the mic is off. */
  readonly transcription: Endpoint | null
  readonly host: string
  readonly port: number
  /** Holds `config.json`. */
  readonly configDir: string
  /** Holds the database and stored files. */
  readonly dataDir: string
  /** Required to use chibot, or `null`: no login. */
  readonly token: string | null
  /** A standalone MCP servers file (`mcp.json`, older than `config.json`'s `mcpServers`); it may not exist. */
  readonly mcpConfigPath: string
  /** `CHIBOT_MCP_CONFIG` was given. */
  readonly mcpConfigExplicit: boolean
  /** Notes for the startup message: older locations still in use. */
  readonly legacyNotes: string[]

  constructor(env: NodeJS.ProcessEnv) {
    const parsed = envSchema.safeParse(env)
    if (!parsed.success) {
      // Named as the variable and as the setting, since either may be wrong.
      const problems = parsed.error.issues.map((issue) => {
        const name = String(issue.path[0] ?? '')
        const setting = settingOf(name)
        return `  - ${name}${setting ? ` (${setting})` : ''}: ${issue.message}`
      })
      throw new Error(`Invalid configuration:\n${problems.join('\n')}`)
    }
    const e = parsed.data
    // On OpenAI, models have defaults; a compatible server needs them named.
    this.chat = endpoint(
      e.OPENAI_BASE_URL,
      e.OPENAI_API_KEY,
      e.OPENAI_MODEL ?? (e.OPENAI_BASE_URL ? undefined : OPENAI_DEFAULT_MODEL),
    )!
    // A feature's endpoint: each part not set (OPENAI_<FEATURE>_*) is the
    // chat endpoint's; the model defaults only on OpenAI.
    const feature = (
      name: 'IMAGE' | 'EMBEDDING' | 'TRANSCRIBE',
      openAIModel: string,
    ) => {
      const baseURL = e[`OPENAI_${name}_BASE_URL`] ?? e.OPENAI_BASE_URL
      return endpoint(
        baseURL,
        e[`OPENAI_${name}_API_KEY`] ?? e.OPENAI_API_KEY,
        e[`OPENAI_${name}_MODEL`] ??
          (isOpenAI(baseURL) ? openAIModel : undefined),
      )
    }
    this.image = feature('IMAGE', 'gpt-image-2')
    this.embedding = feature('EMBEDDING', 'text-embedding-3-small')
    this.transcription = feature('TRANSCRIBE', 'gpt-transcribe')
    this.host = e.HOST
    this.port = e.PORT
    const where = locations(e)
    this.configDir = where.configDir
    this.dataDir = where.dataDir
    this.mcpConfigPath = where.mcpConfigPath
    this.mcpConfigExplicit = where.mcpConfigExplicit
    this.legacyNotes = where.legacy
    this.token = e.CHIBOT_TOKEN ?? null
  }

  get databasePath(): string {
    return join(this.dataDir, 'chibot.db')
  }

  get isLoopback(): boolean {
    return ['127.0.0.1', '::1', 'localhost'].includes(this.host)
  }
}

/** No base URL (the SDK's default) or OpenAI's own. */
function isOpenAI(baseURL: string | undefined): boolean {
  return !baseURL || URL.parse(baseURL)?.hostname === 'api.openai.com'
}

/** An endpoint, or `null` when there's no server and no key (OpenAI needs one). */
function endpoint(
  baseURL: string | undefined,
  apiKey: string | undefined,
  model: string | undefined,
): Endpoint | null {
  if (!baseURL && !apiKey) return null
  // Local servers (Ollama, LM Studio) ignore the key, but the SDK refuses an empty one.
  return { baseURL, apiKey: apiKey ?? 'unused', model: model ?? '' }
}
