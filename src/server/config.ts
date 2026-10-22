/** Typed, validated settings read from environment variables. */
export class Config {
  readonly apiKey: string
  readonly model: string
  readonly host: string
  readonly port: number

  constructor(env: NodeJS.ProcessEnv) {
    const apiKey = env.OPENAI_API_KEY?.trim()
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set (add it to .env)')
    }
    const port = Number(env.PORT ?? 3000)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`PORT must be an integer in 1-65535, got "${env.PORT}"`)
    }
    this.apiKey = apiKey
    this.model = env.OPENAI_MODEL?.trim() || 'gpt-6-astra'
    // Loopback by default: the app has no auth and spends the owner's API key.
    this.host = env.HOST?.trim() || '127.0.0.1'
    this.port = port
  }

  get isLoopback(): boolean {
    return ['127.0.0.1', '::1', 'localhost'].includes(this.host)
  }
}
