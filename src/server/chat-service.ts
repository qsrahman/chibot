import OpenAI from 'openai'
import type {
  ResponseCreateParams,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses'
import { messageText } from '../shared/messages.ts'
import type { Settings } from '../shared/settings.ts'
import { pendingCalls } from '../shared/tools.ts'
import type {
  TurnApprovalEvent,
  TurnRequest,
  TurnTitleEvent,
  TurnToolOutputEvent,
} from '../shared/types.ts'
import type { ConversationStore } from './conversation-store.ts'
import type { SettingsStore } from './settings-store.ts'
import { TOOL_DENIED, ToolRegistry } from './tool-registry.ts'

// remark-math renders only $…$ and $$…$$, so ask models for those.
const FORMAT_INSTRUCTIONS =
  'Write math with $…$ inline and $$…$$ for display, not \\(…\\) or \\[…\\].'

const TITLE_INSTRUCTIONS =
  'Write a short title (3 to 6 words) for the conversation below, in its ' +
  'language. Reply with the title only: no quotes, no trailing punctuation.'

/** Model requests per turn. The last one may not call tools. */
export const MAX_STEPS = 10
const STEP_LIMIT_OUTPUT = 'Error: too many tool calls in one answer.'

/** Runs chat turns statelessly: the full history is sent on every request. */
export class ChatService {
  readonly #client: OpenAI
  readonly #store: ConversationStore
  readonly #settings: SettingsStore
  readonly #tools: ToolRegistry
  // Model + optional-feature combinations the server rejected (400) while
  // the same request without them worked. Kept until restart.
  readonly #unsupported = new Set<string>()

  constructor(
    client: OpenAI,
    store: ConversationStore,
    settings: SettingsStore,
    tools = new ToolRegistry([]),
  ) {
    this.#client = client
    this.#store = store
    this.#settings = settings
    this.#tools = tools
  }

  /**
   * Runs one turn (see `TurnRequest`): appends the user's message unless it's
   * a regenerate, then streams the model's answer to it. When the model calls
   * tools, they run, their outputs are saved and yielded as
   * `chibot.tool_output`, and the model is asked again, up to `MAX_STEPS`
   * requests.
   *
   * Each response is persisted *before* its `response.completed` is yielded,
   * so a client can re-read the conversation as soon as it sees that event.
   * If a stream ends any other way (abort, disconnect, error), the text
   * received so far is kept as a partial assistant message. Every function
   * call on the path gets an output before the next request, so the history
   * stays valid input.
   *
   * A call to a tool that `requiresApproval` ends the turn with
   * `chibot.approval` instead; `{ approvals }` resumes it. A new message
   * sent meanwhile denies the waiting calls.
   *
   * After a completed answer in a saved conversation that has no title yet,
   * a title is generated and yielded as a `chibot.title` event.
   */
  async *runTurn(
    conversationId: string,
    { text, parentId, approvals, tool }: TurnRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<
    | ResponseStreamEvent
    | TurnTitleEvent
    | TurnToolOutputEvent
    | TurnApprovalEvent
  > {
    // The item the next output goes under: the user message being answered,
    // or (resuming after approval) the waiting calls. Callers validate
    // `parentId` and that calls are waiting.
    let leafId: number
    // Calls to answer before the next request.
    let calls: ResponseFunctionToolCall[] = []
    if (approvals) {
      leafId = this.#store.getConversation(conversationId)!.currentLeafId!
      calls = this.#pending(conversationId, leafId)
    } else if (text === undefined) {
      leafId = parentId!
    } else {
      let parent =
        parentId === undefined
          ? this.#store.getConversation(conversationId)!.currentLeafId
          : parentId
      const waiting =
        parent === null ? [] : this.#pending(conversationId, parent)
      if (waiting.length > 0) {
        parent = this.#store
          .appendItems(
            conversationId,
            parent,
            waiting.map((call) => ({
              type: 'function_call_output',
              call_id: call.call_id,
              output: TOOL_DENIED,
            })),
          )
          .at(-1)!.id
      }
      leafId = this.#store.appendItems(conversationId, parent, [
        { role: 'user', content: text },
      ])[0]!.id
    }
    const settings = this.#settings.get()
    const { model, reasoningEffort, compactThreshold } = settings
    const tools = this.#tools.declarations(settings.disabledTools)
    // A tool the user picked is forced on the first request only; after
    // that the model decides (or it would call it forever).
    const forced = tools.find((t) => t.name === tool)

    let answered = false
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (calls.length > 0) {
        leafId = yield* this.#answer(conversationId, leafId, calls, (call) =>
          !this.#tools.get(call.name)?.requiresApproval ||
          approvals?.[call.call_id]
            ? this.#tools.run(call, { conversationId, signal })
            : Promise.resolve(TOOL_DENIED),
        )
        signal?.throwIfAborted()
        approvals = undefined
      }
      const input = fromLastCompaction(
        this.#store.getPath(conversationId, leafId).map((item) => item.data),
      )
      let partial = ''
      let output: ResponseInputItem[] | null = null
      try {
        // Not `responses.stream()`: its accumulator rejects some compatible
        // servers' streams (Ollama gpt-oss: "missing content at index 0"), and
        // chibot must save the answer before relaying `response.completed`.
        const stream = await this.#withOptional(
          model,
          {
            reasoning: {
              summary: 'auto',
              ...(reasoningEffort && { effort: reasoningEffort }),
            },
            ...(compactThreshold !== null && {
              context_management: [
                { type: 'compaction', compact_threshold: compactThreshold },
              ],
            }),
          },
          (optional) =>
            this.#client.responses.create(
              {
                model,
                instructions: chatInstructions(settings),
                input,
                ...(tools.length > 0 && {
                  tools,
                  // Make the last request answer instead of calling more.
                  ...(step === MAX_STEPS && { tool_choice: 'none' as const }),
                  ...(step === 1 &&
                    forced && {
                      tool_choice: { type: 'function', name: forced.name },
                    }),
                }),
                stream: true,
                store: false,
                // Reasoning items can only be replayed without server-side
                // storage when they carry their encrypted content.
                include: ['reasoning.encrypted_content'],
                ...optional,
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
            // Output items are valid input for the next turn. The SDK's types
            // only disagree for item kinds chibot never requests.
            output = event.response.output as ResponseInputItem[]
            const items = this.#store.appendItems(
              conversationId,
              leafId,
              output,
              event.response.usage ?? null,
              // The server may name a dated snapshot of the model requested.
              event.response.model || model,
            )
            leafId = items.at(-1)?.id ?? leafId
            answered = true
          }
          yield event
        }
      } finally {
        // `finally` also runs when the consumer stops iterating (client gone).
        if (!output && partial) {
          this.#store.appendItems(
            conversationId,
            leafId,
            [{ role: 'assistant', content: partial }],
            null,
            model,
          )
        }
      }

      calls = (output ?? []).filter(
        (item): item is ResponseFunctionToolCall =>
          item.type === 'function_call',
      )
      if (calls.length === 0) break
      if (step === MAX_STEPS) {
        // The server ignored `tool_choice: 'none'`.
        leafId = yield* this.#answer(conversationId, leafId, calls, () =>
          Promise.resolve(STEP_LIMIT_OUTPUT),
        )
        break
      }
      if (calls.some((call) => this.#tools.get(call.name)?.requiresApproval)) {
        yield { type: 'chibot.approval', calls }
        break
      }
    }

    const conversation = this.#store.getConversation(conversationId)!
    if (answered && conversation.title === null && !conversation.temporary) {
      const title = await this.#generateTitle(conversationId, signal)
      if (title) yield { type: 'chibot.title', title }
    }
  }

  /** Calls on the path to `leafId` waiting for an output (approval). */
  #pending(conversationId: string, leafId: number) {
    return pendingCalls(
      this.#store.getPath(conversationId, leafId).map((item) => item.data),
    )
  }

  /**
   * Saves an output for each call under `leafId`, then yields them as
   * `chibot.tool_output`, and returns the new leaf. All are saved before any
   * is yielded, so a client leaving at a yield can't leave a call unanswered.
   */
  async *#answer(
    conversationId: string,
    leafId: number,
    calls: ResponseFunctionToolCall[],
    run: (call: ResponseFunctionToolCall) => Promise<string>,
  ): AsyncGenerator<TurnToolOutputEvent, number> {
    const outputs: { call_id: string; output: string }[] = []
    for (const call of calls) {
      outputs.push({ call_id: call.call_id, output: await run(call) })
    }
    const items = this.#store.appendItems(
      conversationId,
      leafId,
      outputs.map((o) => ({ type: 'function_call_output', ...o })),
    )
    for (const o of outputs) yield { type: 'chibot.tool_output', ...o }
    return items.at(-1)!.id
  }

  /** The tools chibot offers (whatever the user switched off), for Settings. */
  get tools(): { name: string; label: string }[] {
    return this.#tools.tools.map(({ name, label }) => ({ name, label }))
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
   * Calls `send` with `optional` request features, or without them where
   * they're rejected: models without reasoning (or without that effort), or
   * compatible servers without compaction, answer 400. A 400 is retried once
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
      const response = await this.#withOptional(
        model,
        { reasoning: { effort: 'low' } },
        (optional) =>
          this.#client.responses.create({ ...params, ...optional }, { signal }),
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

/** Request features some models or servers reject (see `#withOptional`). */
type OptionalParams = Pick<
  ResponseCreateParams,
  'reasoning' | 'context_management'
>

/**
 * The model input for a path: from the last compaction item on (it stands
 * for everything before it), or the whole path if there's none.
 */
export function fromLastCompaction(
  items: ResponseInputItem[],
): ResponseInputItem[] {
  const last = items.findLastIndex((item) => item.type === 'compaction')
  return last === -1 ? items : items.slice(last)
}

/**
 * The built-in lines (math formatting, the current date and time) plus the
 * user's custom instructions.
 */
export function chatInstructions(
  { aboutUser, responseStyle }: Pick<Settings, 'aboutUser' | 'responseStyle'>,
  now = new Date(),
): string {
  // The server's clock and timezone are the user's: chibot runs locally.
  const date = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now)
  const { timeZone } = Intl.DateTimeFormat().resolvedOptions()
  return [
    FORMAT_INSTRUCTIONS,
    `The current date and time is ${date} (${timeZone}).`,
    aboutUser.trim() &&
      `What the user wants you to know about them:\n${aboutUser.trim()}`,
    responseStyle.trim() &&
      `How the user wants you to respond:\n${responseStyle.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n')
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
