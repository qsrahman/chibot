import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses'
import { messageText } from '../../shared/messages.ts'
import type { ConversationStore } from '../conversations/index.ts'
import type { ModelRequests } from './model-requests.ts'
import { cleanSuggestions, SUGGESTION_INSTRUCTIONS } from './prompts.ts'
import { logFailure } from '../api-errors.ts'
import { section } from '../prompt-tags.ts'

/** Suggests what the user might ask next, after an answer. */
export class FollowUpWriter {
  readonly #model: ModelRequests
  readonly #store: ConversationStore
  /** The model to ask; `''` turns suggestions off. Read on each call. */
  readonly #modelName: () => string

  constructor(
    model: ModelRequests,
    store: ConversationStore,
    modelName: () => string,
  ) {
    this.#model = model
    this.#store = store
    this.#modelName = modelName
  }

  /**
   * Up to three prompts that could follow the chat's latest answer. Empty
   * when suggestions are off, the chat doesn't end in an answer, or the
   * model fails. Never throws.
   */
  async suggest(
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const model = this.#modelName()
    if (!model) return []
    const messages = this.#store
      .getPath(conversationId)
      .flatMap((item) => messageText(item.data) ?? [])
    const answer = messages.at(-1)
    const question = messages.at(-2)
    if (answer?.role !== 'assistant' || question?.role !== 'user') return []
    const params: ResponseCreateParamsNonStreaming & { model: string } = {
      model,
      instructions: SUGGESTION_INSTRUCTIONS,
      input: section(
        'exchange',
        `user: ${question.text.slice(0, 1000)}\n\nassistant: ${answer.text.slice(0, 2000)}`,
      ),
      store: false,
    }
    try {
      const response = await this.#model.complete(
        params,
        { reasoning: { effort: 'low' } },
        signal,
      )
      return cleanSuggestions(response.output_text)
    } catch (err) {
      if (!signal?.aborted) logFailure('Follow-up suggestions failed', err)
      return []
    }
  }
}
