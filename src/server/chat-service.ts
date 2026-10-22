import OpenAI from 'openai'
import type {
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses'
import { messageText } from '../shared/messages.ts'
import type { TurnTitleEvent } from '../shared/types.ts'
import type { ConversationStore } from './conversation-store.ts'

const TITLE_INSTRUCTIONS =
  'Write a short title (3 to 6 words) for the conversation below, in its ' +
  'language. Reply with the title only: no quotes, no trailing punctuation.'

/** Runs chat turns statelessly: the full history is sent on every request. */
export class ChatService {
  readonly #client: OpenAI
  readonly #store: ConversationStore
  readonly #model: string

  constructor(client: OpenAI, store: ConversationStore, model: string) {
    this.#client = client
    this.#store = store
    this.#model = model
  }

  /**
   * Appends the user's message and streams the model's answer.
   *
   * The answer is persisted *before* `response.completed` is yielded, so a
   * client can re-read the conversation as soon as it sees that event. If the
   * stream ends any other way (abort, disconnect, error), the text received so
   * far is kept as a partial assistant message.
   *
   * After a completed answer in a saved conversation that has no title yet,
   * a title is generated and yielded as a `chibot.title` event.
   */
  async *sendMessage(
    conversationId: string,
    text: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ResponseStreamEvent | TurnTitleEvent> {
    const leaf = this.#store.getConversation(conversationId)!.currentLeafId
    const [userItem] = this.#store.appendItems(conversationId, leaf, [
      { role: 'user', content: text },
    ])
    const input = this.#store.getPath(conversationId).map((item) => item.data)

    let partial = ''
    let saved = false
    try {
      const stream = await this.#client.responses.create(
        {
          model: this.#model,
          input,
          stream: true,
          store: false,
          // Reasoning items can only be replayed without server-side storage
          // when they carry their encrypted content.
          include: ['reasoning.encrypted_content'],
        },
        { signal },
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
            userItem!.id,
            // Output items are valid input for the next turn. The SDK's types
            // only disagree for item kinds chibot never requests.
            output as ResponseInputItem[],
            usage ?? null,
          )
          saved = true
        }
        yield event
      }
    } finally {
      // `finally` also runs when the consumer stops iterating (client gone).
      if (!saved && partial) {
        this.#store.appendItems(conversationId, userItem!.id, [
          { role: 'assistant', content: partial },
        ])
      }
    }

    const conversation = this.#store.getConversation(conversationId)!
    if (saved && conversation.title === null && !conversation.temporary) {
      const title = await this.#generateTitle(conversationId, signal)
      if (title) yield { type: 'chibot.title', title }
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
    const params: ResponseCreateParamsNonStreaming = {
      model: this.#model,
      instructions: TITLE_INSTRUCTIONS,
      input: transcript,
      store: false,
    }
    try {
      let response
      try {
        response = await this.#client.responses.create(
          { ...params, reasoning: { effort: 'low' } },
          { signal },
        )
      } catch (err) {
        // Models without reasoning reject the parameter; retry without it.
        if (!(err instanceof OpenAI.BadRequestError)) throw err
        response = await this.#client.responses.create(params, { signal })
      }
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
