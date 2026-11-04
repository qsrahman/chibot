import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses'
import { messageText } from '../../shared/messages.ts'
import type { ConversationStore } from '../conversations/index.ts'
import type { ModelRequests } from './model-requests.ts'
import { cleanTitle, TITLE_INSTRUCTIONS } from './prompts.ts'
import type { SettingsStore } from '../settings-store.ts'

/** Names chats from their opening messages. */
export class TitleWriter {
  readonly #model: ModelRequests
  readonly #store: ConversationStore
  readonly #settings: SettingsStore

  constructor(
    model: ModelRequests,
    store: ConversationStore,
    settings: SettingsStore,
  ) {
    this.#model = model
    this.#store = store
    this.#settings = settings
  }

  /** A title for a chat that has none yet (never a temporary one), or `null`. */
  async ifNew(
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    // Read again: the title may have been set meanwhile.
    const current = this.#store.getConversation(conversationId)!
    if (current.title !== null || current.temporary) return null
    return this.#write(conversationId, signal, false)
  }

  /**
   * Names the chat again from its first messages, replacing its title
   * (also one the user typed). Null if the model gave none.
   */
  regenerate(
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    return this.#write(conversationId, signal, true)
  }

  /** Names the conversation from its opening messages. Never throws. */
  async #write(
    conversationId: string,
    signal: AbortSignal | undefined,
    replace: boolean,
  ): Promise<string | null> {
    const transcript = this.#store
      .getPath(conversationId)
      .flatMap((item) => messageText(item.data) ?? [])
      .slice(0, 2)
      .map(({ role, text }) => `${role}: ${text.slice(0, 1000)}`)
      .join('\n\n')
    const { model } = this.#settings.get()
    const params: ResponseCreateParamsNonStreaming & { model: string } = {
      model,
      instructions: TITLE_INSTRUCTIONS,
      input: transcript,
      store: false,
    }
    try {
      const response = await this.#model.complete(
        params,
        { reasoning: { effort: 'low' } },
        signal,
      )
      const title = cleanTitle(response.output_text)
      if (!title) return null
      if (replace) {
        this.#store.updateConversation(conversationId, { title })
        return title
      }
      return this.#store.setTitleIfEmpty(conversationId, title) ? title : null
    } catch (err) {
      if (!signal?.aborted) console.error('Title generation failed:', err)
      return null
    }
  }
}
