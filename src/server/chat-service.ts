import OpenAI from 'openai'
import type { Reasoning } from 'openai/resources/shared'
import type {
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses'
import { messageText } from '../shared/messages.ts'
import type { TurnRequest, TurnTitleEvent } from '../shared/types.ts'
import type { ConversationStore } from './conversation-store.ts'
import type { SettingsStore } from './settings-store.ts'

const TITLE_INSTRUCTIONS =
  'Write a short title (3 to 6 words) for the conversation below, in its ' +
  'language. Reply with the title only: no quotes, no trailing punctuation.'

/** Runs chat turns statelessly: the full history is sent on every request. */
export class ChatService {
  readonly #client: OpenAI
  readonly #store: ConversationStore
  readonly #settings: SettingsStore
  // "model|effort" combinations whose `reasoning` the server rejected (400)
  // while the same request without it worked. Kept until restart.
  readonly #withoutReasoning = new Set<string>()

  constructor(
    client: OpenAI,
    store: ConversationStore,
    settings: SettingsStore,
  ) {
    this.#client = client
    this.#store = store
    this.#settings = settings
  }

  /**
   * Runs one turn (see `TurnRequest`): appends the user's message unless it's
   * a regenerate, then streams the model's answer to it.
   *
   * The answer is persisted *before* `response.completed` is yielded, so a
   * client can re-read the conversation as soon as it sees that event. If the
   * stream ends any other way (abort, disconnect, error), the text received so
   * far is kept as a partial assistant message.
   *
   * After a completed answer in a saved conversation that has no title yet,
   * a title is generated and yielded as a `chibot.title` event.
   */
  async *runTurn(
    conversationId: string,
    { text, parentId }: TurnRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ResponseStreamEvent | TurnTitleEvent> {
    // The user message the answer goes under. Callers validate `parentId`.
    let questionId: number
    if (text === undefined) {
      questionId = parentId!
    } else {
      const parent =
        parentId === undefined
          ? this.#store.getConversation(conversationId)!.currentLeafId
          : parentId
      questionId = this.#store.appendItems(conversationId, parent, [
        { role: 'user', content: text },
      ])[0]!.id
    }
    const input = this.#store
      .getPath(conversationId, questionId)
      .map((item) => item.data)
    const { model, reasoningEffort } = this.#settings.get()

    let partial = ''
    let saved = false
    try {
      // Not `responses.stream()`: its accumulator rejects some compatible
      // servers' streams (Ollama gpt-oss: "missing content at index 0"), and
      // chibot must save the answer before relaying `response.completed`.
      const stream = await this.#tryReasoning(
        model,
        {
          summary: 'auto',
          ...(reasoningEffort && { effort: reasoningEffort }),
        },
        (reasoning) =>
          this.#client.responses.create(
            {
              model,
              input,
              stream: true,
              store: false,
              // Reasoning items can only be replayed without server-side
              // storage when they carry their encrypted content.
              include: ['reasoning.encrypted_content'],
              ...(reasoning && { reasoning }),
            },
            { signal },
          ),
      )
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          partial += event.delta
        } else if (
          event.type === 'response.completed' ||
          event.type === 'response.incomplete'
        ) {
          const { output, usage } = event.response
          this.#store.appendItems(
            conversationId,
            questionId,
            // Output items are valid input for the next turn. The SDK's types
            // only disagree for item kinds chibot never requests.
            output as ResponseInputItem[],
            usage ?? null,
            // The server may name a dated snapshot of the model requested.
            event.response.model || model,
          )
          saved = true
        }
        yield event
      }
    } finally {
      // `finally` also runs when the consumer stops iterating (client gone).
      if (!saved && partial) {
        this.#store.appendItems(
          conversationId,
          questionId,
          [{ role: 'assistant', content: partial }],
          null,
          model,
        )
      }
    }

    const conversation = this.#store.getConversation(conversationId)!
    if (saved && conversation.title === null && !conversation.temporary) {
      const title = await this.#generateTitle(conversationId, signal)
      if (title) yield { type: 'chibot.title', title }
    }
  }

  /**
   * Model ids the chat endpoint offers, sorted, or `null` when it can't list
   * them. The list isn't filtered: it mixes chat, embedding, image and audio
   * models, and their ids don't reliably say which is which.
   */
  async listModels(): Promise<string[] | null> {
    try {
      const ids: string[] = []
      for await (const model of this.#client.models.list()) ids.push(model.id)
      return ids.sort()
    } catch (err) {
      console.error('Listing models failed:', err)
      return null
    }
  }

  /**
   * Calls `send` with `reasoning`, or without it for models that reject it:
   * models without reasoning (or without that effort) answer 400. A 400 is
   * retried once without `reasoning`; if that works, the combination is
   * remembered so later requests skip the failing attempt.
   */
  async #tryReasoning<T>(
    model: string,
    reasoning: Reasoning,
    send: (reasoning?: Reasoning) => Promise<T>,
  ): Promise<T> {
    const key = `${model}|${reasoning.effort ?? ''}`
    if (this.#withoutReasoning.has(key)) return send()
    try {
      return await send(reasoning)
    } catch (err) {
      if (!(err instanceof OpenAI.BadRequestError)) throw err
      const result = await send()
      this.#withoutReasoning.add(key)
      return result
    }
  }

  /** Names the conversation from its opening messages. Never throws. */
  async #generateTitle(
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const transcript = this.#store
      .getPath(conversationId)
      .flatMap((item) => messageText(item.data) ?? [])
      .slice(0, 2)
      .map(({ role, text }) => `${role}: ${text.slice(0, 1000)}`)
      .join('\n\n')
    const { model } = this.#settings.get()
    const params: ResponseCreateParamsNonStreaming = {
      model,
      instructions: TITLE_INSTRUCTIONS,
      input: transcript,
      store: false,
    }
    try {
      const response = await this.#tryReasoning(
        model,
        { effort: 'low' },
        (reasoning) =>
          this.#client.responses.create(
            { ...params, ...(reasoning && { reasoning }) },
            { signal },
          ),
      )
      const title = cleanTitle(response.output_text)
      if (title) this.#store.updateConversation(conversationId, { title })
      return title
    } catch (err) {
      if (!signal?.aborted) console.error('Title generation failed:', err)
      return null
    }
  }
}

/** First line, without quotes, Markdown emphasis or a trailing full stop. */
function cleanTitle(raw: string): string | null {
  const line = raw.trim().split('\n')[0] ?? ''
  const title = line
    .replace(/^[#*\s"'“”‘’]+|[*\s"'“”‘’.]+$/g, '')
    .slice(0, 80)
    .trim()
  return title || null
}
