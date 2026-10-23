import OpenAI from 'openai'
import type { Endpoint } from './config.ts'

/** Voice input: recordings to text, through the transcription endpoint. */
export class Transcription {
  readonly #client: OpenAI
  readonly #model: string

  constructor(client: OpenAI, model: string) {
    this.#client = client
    this.#model = model
  }

  /** From `Config.transcription`. */
  static from({ baseURL, apiKey, model }: Endpoint): Transcription {
    return new Transcription(new OpenAI({ baseURL, apiKey }), model)
  }

  /**
   * The recording's text. Failures say which endpoint and model failed, and
   * for a missing or unreachable endpoint what to set (a chat model or a
   * server without transcription is the usual cause).
   */
  async transcribe(audio: File, signal?: AbortSignal): Promise<string> {
    try {
      const { text } = await this.#client.audio.transcriptions.create(
        { file: audio, model: this.#model },
        { signal },
      )
      return text
    } catch (err) {
      if (!(err instanceof OpenAI.APIError)) throw err
      console.error('Transcription failed:', err)
      const setup =
        err instanceof OpenAI.NotFoundError ||
        err instanceof OpenAI.APIConnectionError
      throw new Error(
        `Transcription at ${this.#client.baseURL} (model ${this.#model}) ` +
          `failed: ${err.message.replace(/\.$/, '')}` +
          (setup
            ? '. It needs a transcription model (e.g. gpt-transcribe) on a ' +
              'server that transcribes: check OPENAI_TRANSCRIBE_MODEL and ' +
              'OPENAI_TRANSCRIBE_BASE_URL in .env.'
            : '.'),
        { cause: err },
      )
    }
  }
}
