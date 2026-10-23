import { join, resolve } from 'node:path'
import { z } from 'zod'

/** The repo root, found from this file, so `chibot` works from any folder. */
const ROOT = join(import.meta.dirname, '../..')

/**
 * Loads `.env` from the current folder, then from the repo. Neither
 * overrides a variable that's already set, so the real environment wins,
 * then the current folder's file, then the repo's.
 *
 * @returns the files that were found and loaded
 */
export function loadEnvFiles(
  paths = [resolve('.env'), join(ROOT, '.env')],
): string[] {
  const loaded: string[] = []
  for (const path of new Set(paths)) {
    try {
      process.loadEnvFile(path)
      loaded.push(path)
    } catch (err) {
      // A missing file is fine: variables may come from elsewhere.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  return loaded
}

/** Connection to an OpenAI or OpenAI-compatible (Responses API) server. */
export interface Endpoint {
  /** `undefined` means the SDK's default (OpenAI). */
  baseURL: string | undefined
  apiKey: string
  model: string
}

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
    BRAVE_API_KEY: optional,
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
    CHIBOT_DATA_DIR: optional,
  })
  .superRefine((env, ctx) => {
    if (!env.OPENAI_API_KEY && !env.OPENAI_BASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'is not set (add it to .env)',
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
  /** Image generation, or `null` when there's no image model to use. */
  readonly image: Endpoint | null
  /** Project file embeddings, or `null`: then search is by keywords only. */
  readonly embedding: Endpoint | null
  /** Voice input, or `null`: then the mic is off. */
  readonly transcription: Endpoint | null
  /** Enables the web search tool. */
  readonly braveApiKey: string | null
  readonly host: string
  readonly port: number
  /** Holds the database and stored files. */
  readonly dataDir: string

  constructor(env: NodeJS.ProcessEnv) {
    const parsed = envSchema.safeParse(env)
    if (!parsed.success) {
      throw new Error(
        `Invalid configuration:\n${z.prettifyError(parsed.error)}`,
      )
    }
    const e = parsed.data
    // On OpenAI, models have defaults; a compatible server needs them named.
    this.chat = endpoint(
      e.OPENAI_BASE_URL,
      e.OPENAI_API_KEY,
      e.OPENAI_MODEL ?? (e.OPENAI_BASE_URL ? undefined : 'gpt-6-astra'),
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
    this.braveApiKey = e.BRAVE_API_KEY ?? null
    this.host = e.HOST
    this.port = e.PORT
    this.dataDir = e.CHIBOT_DATA_DIR
      ? resolve(e.CHIBOT_DATA_DIR)
      : join(ROOT, 'data')
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

/** An endpoint, or `null` when it can't be used: no model, or OpenAI without a key. */
function endpoint(
  baseURL: string | undefined,
  apiKey: string | undefined,
  model: string | undefined,
): Endpoint | null {
  if (!model || (!baseURL && !apiKey)) return null
  // Local servers (Ollama, LM Studio) ignore the key, but the SDK refuses an empty one.
  return { baseURL, apiKey: apiKey ?? 'unused', model }
}
