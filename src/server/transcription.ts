import OpenAI from 'openai'
import { logFailure } from './api-errors.ts'
import type { Endpoint } from './config.ts'

/** Voice input: recordings to text, through the transcription endpoint. */
export class Transcription {
  readonly #client: OpenAI
  readonly #model: () => string
  readonly #language: () => string

  /**
   * @param model read at each call, since Settings can change it; `''` is off
   * @param language the same: the language spoken (ISO 639-1), or `''` to let the model detect it
   */
  constructor(
    client: OpenAI,
    model: () => string,
    language: () => string = () => '',
  ) {
    this.#client = client
    this.#model = model
    this.#language = language
  }

  /** From `Config.transcription`. */
  static from(
    { baseURL, apiKey }: Endpoint,
    model: () => string,
    language?: () => string,
  ): Transcription {
    return new Transcription(new OpenAI({ baseURL, apiKey }), model, language)
  }

  /** Whether there is a model to transcribe with. */
  get available(): boolean {
    return this.#model() !== ''
  }

  /**
   * The recording's text. Failures say which endpoint and model failed, and
   * for a missing or unreachable endpoint what to set (a chat model or a
   * server without transcription is the usual cause).
   */
  async transcribe(audio: File, signal?: AbortSignal): Promise<string> {
    const model = this.#model()
    // Said, it helps short phrases and accents; unsaid, the model detects it.
    const language = this.#language()
    try {
      const { text } = await this.#client.audio.transcriptions.create(
        { file: audio, model, ...(language && { language }) },
        { signal },
      )
      return text
    } catch (err) {
      if (!(err instanceof OpenAI.APIError)) throw err
      logFailure('Transcription failed', err)
      const setup =
        err instanceof OpenAI.NotFoundError ||
        err instanceof OpenAI.APIConnectionError
      throw new Error(
        `Transcription at ${this.#client.baseURL} (model ${model}) ` +
          `failed: ${err.message.replace(/\.$/, '')}` +
          (setup
            ? '. It needs a transcription model (e.g. gpt-transcribe) on a ' +
              'server that transcribes: check the model in Settings → ' +
              'Other models and transcription.baseURL (`chibot config path` ' +
              'shows where the settings are).'
            : '.'),
        { cause: err },
      )
    }
  }
}
