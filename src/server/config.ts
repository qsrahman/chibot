/** Typed, validated settings read from environment variables. */
export class Config {
  readonly apiKey: string
  readonly model: string
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
    this.port = port
  }
}
