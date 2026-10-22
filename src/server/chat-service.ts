import type OpenAI from 'openai'
import type {
  ResponseInputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses'
import type { ConversationStore } from './conversation-store.ts'

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
   */
  async *sendMessage(
    conversationId: string,
    text: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ResponseStreamEvent> {
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
  }
}
