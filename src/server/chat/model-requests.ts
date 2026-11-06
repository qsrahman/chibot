import OpenAI from 'openai'
import type {
  Response,
  ResponseCreateParams,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses'
import type { Stream } from 'openai/streaming'
import type { Attachments } from '../attachments.ts'
import { chatModels } from './chat-models.ts'

/** Request features some models or servers reject (see `ModelRequests`). */
export type OptionalParams = Pick<ResponseCreateParams, 'reasoning'>

/**
 * Requests to the model endpoint, made to work with what it supports:
 * optional features are dropped where a server rejects them, and attachments
 * are sent in whatever form the model takes. What to ask is the callers'.
 */
export class ModelRequests {
  readonly #client: OpenAI
  readonly #attachments: Attachments | null
  // Model + optional-feature combinations the server rejected (400) while
  // the same request without them worked. Kept until restart.
  readonly #unsupported = new Set<string>()

  /** @param attachments to send files attached to messages */
  constructor(client: OpenAI, attachments: Attachments | null = null) {
    this.#client = client
    this.#attachments = attachments
  }

  /**
   * A streamed response. Not `responses.stream()`: its accumulator rejects
   * some compatible servers' streams (Ollama gpt-oss: "missing content at
   * index 0"), and chibot must save the answer before relaying
   * `response.completed`.
   */
  stream(
    params: Omit<ResponseCreateParamsStreaming, 'input'> & {
      model: string
      input: ResponseInputItem[]
    },
    optional: OptionalParams,
    signal?: AbortSignal,
  ): Promise<Stream<ResponseStreamEvent>> {
    return this.#withAttachments(params.model, params.input, (input) =>
      this.#withOptional(params.model, optional, (optional) =>
        this.#client.responses.create(
          { ...params, input, ...optional },
          { signal },
        ),
      ),
    )
  }

  /** A response in one piece (no attachments). */
  complete(
    params: ResponseCreateParamsNonStreaming & { model: string },
    optional: OptionalParams,
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.#withOptional(params.model, optional, (optional) =>
      this.#client.responses.create({ ...params, ...optional }, { signal }),
    )
  }

  /**
   * The chat models the endpoint offers, sorted, or `null` when it can't
   * list them (see `chatModels` for how the others are left out).
   */
  async listModels(): Promise<string[] | null> {
    try {
      const ids: string[] = []
      for await (const model of this.#client.models.list()) ids.push(model.id)
      return (await chatModels(ids, this.#client.baseURL)).sort()
    } catch (err) {
      console.error('Listing models failed:', err)
      return null
    }
  }

  /**
   * The context window the server reports for `model`, in tokens, or `null`
   * when it doesn't say. Servers differ: OpenRouter's model list has
   * `context_length` and LM Studio's `max_context_length`; Ollama's
   * `/api/show` lists `num_ctx` only when the model sets one (otherwise the
   * window in use is the server's default, which isn't reported, so none is
   * guessed). Never throws.
   */
  async contextWindow(model: string): Promise<number | null> {
    try {
      for await (const entry of this.#client.models.list()) {
        if (entry.id !== model) continue
        const listed = entry as unknown as Record<string, unknown>
        const window = listed.context_length ?? listed.max_context_length
        if (typeof window === 'number' && window > 0) return window
      }
    } catch {
      // Not listed: try Ollama's own API next.
    }
    try {
      const base = new URL(this.#client.baseURL)
      const res = await fetch(new URL('/api/show', base.origin), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#client.apiKey}`,
        },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return null
      const { parameters } = (await res.json()) as { parameters?: unknown }
      const match = /^num_ctx\s+(\d+)/m.exec(String(parameters ?? ''))
      return match ? Number(match[1]) : null
    } catch {
      return null
    }
  }

  /**
   * Calls `send` with `optional` request features, or without them where
   * they're rejected: models without reasoning (or without that effort) answer 400. A 400 is retried once
   * without them; if that works, the combination is remembered so later
   * requests skip the failing attempt.
   */
  async #withOptional<T>(
    model: string,
    optional: OptionalParams,
    send: (optional: OptionalParams) => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify([model, optional])
    if (this.#unsupported.has(key)) return send({})
    try {
      return await send(optional)
    } catch (err) {
      if (!(err instanceof OpenAI.BadRequestError)) throw err
      const result = await send({})
      this.#unsupported.add(key)
      return result
    }
  }

  /**
   * Sends `input` with its attachments resolved (see `Attachments`). A model
   * that rejects files (400) gets documents as their text from then on, and
   * a provider that lost an upload (404) gets it again: each retried once.
   */
  async #withAttachments<T>(
    model: string,
    input: ResponseInputItem[],
    send: (input: ResponseInputItem[]) => Promise<T>,
  ): Promise<T> {
    const attachments = this.#attachments
    if (!attachments) return send(input)
    // A refused request with images most likely means the model can't see
    // them; the server's own message (often just "400") doesn't say what to do.
    const explain = (err: unknown) =>
      err instanceof OpenAI.BadRequestError && attachments.sendsImages(input)
        ? new Error(
            `${model} refused this chat's images (${err.message}). ` +
              'If it can’t see images, pick a model that can (e.g. gemma4 ' +
              'on Ollama, or OpenAI’s GPT models).',
            { cause: err },
          )
        : err
    try {
      return await send(await attachments.resolve(input, model))
    } catch (err) {
      if (
        err instanceof OpenAI.BadRequestError &&
        attachments.sendsFiles(input, model)
      ) {
        attachments.useText(model)
      } else if (
        err instanceof OpenAI.NotFoundError &&
        attachments.uploaded(input)
      ) {
        attachments.forgetUploads(input)
      } else {
        throw explain(err)
      }
    }
    try {
      return await send(await attachments.resolve(input, model))
    } catch (err) {
      throw explain(err)
    }
  }
}
