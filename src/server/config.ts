/** Connection to an OpenAI or OpenAI-compatible (Responses API) server. */
export interface Endpoint {
  /** `undefined` means the SDK's default (OpenAI). */
  baseURL: string | undefined
  apiKey: string
  model: string
}

/** Typed, validated settings read from environment variables. */
export class Config {
  readonly chat: Endpoint
  readonly host: string
  readonly port: number

  constructor(env: NodeJS.ProcessEnv) {
    const baseURL = env.OPENAI_BASE_URL?.trim() || undefined
    const apiKey = env.OPENAI_API_KEY?.trim()
    const model = env.OPENAI_MODEL?.trim()
    if (!apiKey && !baseURL) {
      throw new Error('OPENAI_API_KEY is not set (add it to .env)')
    }
    if (!model && baseURL) {
      throw new Error('OPENAI_MODEL is required when OPENAI_BASE_URL is set')
    }
    const port = Number(env.PORT ?? 3000)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`PORT must be an integer in 1-65535, got "${env.PORT}"`)
    }
    this.chat = {
      baseURL,
      // Local servers (Ollama, LM Studio) ignore the key, but the SDK refuses an empty one.
      apiKey: apiKey || 'unused',
      model: model || 'gpt-6-astra',
    }
    // Loopback by default: the app has no auth and spends the owner's API key.
    this.host = env.HOST?.trim() || '127.0.0.1'
    this.port = port
  }

  get isLoopback(): boolean {
    return ['127.0.0.1', '::1', 'localhost'].includes(this.host)
  }
}
