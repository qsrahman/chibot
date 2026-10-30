import OpenAI from 'openai'
import type {
  FunctionTool,
  ResponseCreateParams,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses'
import { messageText } from '../shared/messages.ts'
import type { Settings } from '../shared/settings.ts'
import { sortTools, type ToolInfo } from '../shared/tools.ts'
import type {
  Conversation,
  TurnApprovalEvent,
  TurnRequest,
  TurnTitleEvent,
  TurnToolOutputEvent,
} from '../shared/types.ts'
import type { Attachments } from './attachments.ts'
import { chatModels } from './chat-models.ts'
import type { ConversationStore } from './conversation-store.ts'
import type { ProjectStore } from './project-store.ts'
import type { SettingsStore } from './settings-store.ts'
import { chatInstructions, cleanTitle, TITLE_INSTRUCTIONS } from './prompts.ts'
import { TOOL_DENIED, ToolRegistry } from './tool-registry.ts'

/** What `runTurn` yields. */
type TurnEvent =
  ResponseStreamEvent | TurnTitleEvent | TurnToolOutputEvent | TurnApprovalEvent

/** What a turn sends the model, fixed when it starts. */
interface TurnPlan {
  conversation: Conversation
  model: string
  reasoningEffort: Settings['reasoningEffort']
  compactThreshold: number | null
  /** The tools offered, as request entries. */
  tools: FunctionTool[]
  /** Tools a call is refused for: unavailable, switched off or not offered here. */
  disabled: string[]
  instructions: string
  /** The tool the user picked for this message, if any. */
  forced: FunctionTool | undefined
}

// How long a turn waits for the previous turn of its chat to unwind.
const PREVIOUS_TURN_WAIT_MS = 5000

/** Model requests per turn. The last one may not call tools. */
export const MAX_STEPS = 10
const STEP_LIMIT_OUTPUT = 'Error: too many tool calls in one answer.'

/** Runs chat turns statelessly: the full history is sent on every request. */
export class ChatService {
  readonly #client: OpenAI
  readonly #store: ConversationStore
  readonly #settings: SettingsStore
  readonly #tools: ToolRegistry
  readonly #projects: ProjectStore | null
  readonly #attachments: Attachments | null
  // Each chat's latest turn, until it has finished unwinding.
  readonly #turns = new Map<string, Promise<void>>()
  // Model + optional-feature combinations the server rejected (400) while
  // the same request without them worked. Kept until restart.
  readonly #unsupported = new Set<string>()

  /**
   * @param options.tools offered to the model (none by default)
   * @param options.projects for project chats' instructions
   * @param options.attachments to send files attached to messages
   */
  constructor(
    client: OpenAI,
    store: ConversationStore,
    settings: SettingsStore,
    {
      tools = new ToolRegistry([]),
      projects = null,
      attachments = null,
    }: {
      tools?: ToolRegistry
      projects?: ProjectStore | null
      attachments?: Attachments | null
    } = {},
  ) {
    this.#client = client
    this.#store = store
    this.#settings = settings
    this.#tools = tools
    this.#projects = projects
    this.#attachments = attachments
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
   * A call to a tool that needs approval (see `Tool.requiresApproval`) ends
   * the turn with `chibot.approval` instead; `{ approvals }` resumes it. A
   * new message sent meanwhile denies the waiting calls.
   *
   * After a completed answer in a saved conversation that has no title yet,
   * a title is generated and yielded as a `chibot.title` event.
   *
   * A chat's turns run one after another: a turn first waits (at most
   * `PREVIOUS_TURN_WAIT_MS`) for the previous one to finish unwinding. A
   * message sent right after Stop can arrive before the server has noticed the
   * disconnect, and must follow the partial answer that turn is about to save.
   */
  async *runTurn(
    conversationId: string,
    request: TurnRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<TurnEvent> {
    const previous = this.#turns.get(conversationId)
    const finished = Promise.withResolvers<void>()
    this.#turns.set(conversationId, finished.promise)
    try {
      if (previous) await untilOrTimeout(previous, PREVIOUS_TURN_WAIT_MS)
      yield* this.#runTurn(conversationId, request, signal, finished.resolve)
    } finally {
      finished.resolve()
      if (this.#turns.get(conversationId) === finished.promise) {
        this.#turns.delete(conversationId)
      }
    }
  }

  /** @param saved called once everything is saved, before the title */
  async *#runTurn(
    conversationId: string,
    request: TurnRequest,
    signal: AbortSignal | undefined,
    saved: () => void,
  ): AsyncGenerator<TurnEvent> {
    let { leafId, calls } = this.#startTurn(conversationId, request)
    const plan = this.#planTurn(conversationId, request.tool)
    let approvals = request.approvals
    let answered = false
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (calls.length > 0) {
        leafId = yield* this.#runCalls(
          plan,
          conversationId,
          leafId,
          calls,
          approvals,
          signal,
        )
        signal?.throwIfAborted()
        approvals = undefined
      }
      const response = yield* this.#respond(
        plan,
        conversationId,
        leafId,
        step,
        signal,
      )
      leafId = response.leafId
      answered ||= response.answered

      calls = (response.output ?? []).filter(
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
      const history = this.#history(conversationId, leafId)
      if (calls.some((call) => this.#tools.needsApproval(call, history))) {
        yield { type: 'chibot.approval', calls }
        break
      }
    }

    // The title may take a while, and the chat no longer changes meanwhile.
    saved()
    const title = answered
      ? await this.#titleIfNew(conversationId, signal)
      : null
    if (title) yield { type: 'chibot.title', title }
  }

  /**
   * Saves the user's message (unless this is a regenerate or a resume after
   * approval) and finds where the answer goes: the item the next output goes
   * under, and the calls to answer before the next request. Callers validate
   * `parentId`, `fileIds` (only with `attachments`) and that calls are waiting.
   */
  #startTurn(
    conversationId: string,
    { text, parentId, approvals, fileIds = [] }: TurnRequest,
  ): { leafId: number; calls: ResponseFunctionToolCall[] } {
    if (approvals) {
      const leafId = this.#store.getConversation(conversationId)!.currentLeafId!
      return { leafId, calls: this.waitingCalls(conversationId, leafId) }
    }
    if (text === undefined) return { leafId: parentId!, calls: [] }

    let parent =
      parentId === undefined
        ? this.#store.getConversation(conversationId)!.currentLeafId
        : parentId
    const waiting =
      parent === null ? [] : this.waitingCalls(conversationId, parent)
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
    const content =
      fileIds.length > 0
        ? [
            ...this.#attachments!.parts(fileIds),
            // Files alone are a message too.
            ...(text.trim() ? [{ type: 'input_text' as const, text }] : []),
          ]
        : text
    const leafId = this.#store.appendItems(conversationId, parent, [
      { role: 'user', content },
    ])[0]!.id
    return { leafId, calls: [] }
  }

  /** What the turn sends the model, from the settings and tools as they are now. */
  #planTurn(conversationId: string, tool: string | undefined): TurnPlan {
    const settings = this.#settings.get()
    const conversation = this.#store.getConversation(conversationId)!
    const offered = this.#tools.tools.filter(
      (t) =>
        t.unavailable() === null &&
        !settings.disabledTools.includes(t.name) &&
        t.offeredIn(conversation),
    )
    const tools = offered.map((t) => t.declaration)
    const project = conversation.projectId
      ? this.#projects?.get(conversation.projectId)
      : null
    return {
      conversation,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      compactThreshold: settings.compactThreshold,
      tools,
      disabled: this.#tools.tools
        .filter((t) => !offered.includes(t))
        .map((t) => t.name),
      instructions: chatInstructions(settings, {
        project,
        tools: offered.length > 0,
        untrusted: offered.some((t) => t.untrustedOutput),
        toolInstructions: offered.map((t) => t.instructions(conversation)),
      }),
      // A tool the user picked is forced on the first request only; after
      // that the model decides (or it would call it forever).
      forced: tools.find((t) => t.name === tool),
    }
  }

  /**
   * Runs the calls the last response made (the approved ones; the rest get
   * `TOOL_DENIED`), saves their outputs and yields them as `chibot.tool_output`.
   * Returns the new leaf.
   */
  async *#runCalls(
    plan: TurnPlan,
    conversationId: string,
    leafId: number,
    calls: ResponseFunctionToolCall[],
    approvals: TurnRequest['approvals'],
    signal: AbortSignal | undefined,
  ): AsyncGenerator<TurnToolOutputEvent, number> {
    const history = this.#history(conversationId, leafId)
    return yield* this.#answer(conversationId, leafId, calls, (call) =>
      !this.#tools.needsApproval(call, history) || approvals?.[call.call_id]
        ? this.#tools.run(
            call,
            {
              conversationId,
              projectId: plan.conversation.projectId,
              signal,
            },
            plan.disabled,
          )
        : Promise.resolve(TOOL_DENIED),
    )
  }

  /**
   * One request to the model, streamed: yields its events and saves the
   * response (before its `response.completed` is yielded). If the stream ends
   * any other way, the text received so far is kept as a partial answer.
   * Returns the new leaf, the response's output (`null` if it never
   * completed) and whether it completed.
   */
  async *#respond(
    plan: TurnPlan,
    conversationId: string,
    leafId: number,
    step: number,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<
    ResponseStreamEvent,
    { leafId: number; output: ResponseInputItem[] | null; answered: boolean }
  > {
    const { model, instructions, tools, forced } = plan
    const input = fromLastCompaction(this.#history(conversationId, leafId))
    let partial = ''
    let output: ResponseInputItem[] | null = null
    let answered = false
    try {
      // Not `responses.stream()`: its accumulator rejects some compatible
      // servers' streams (Ollama gpt-oss: "missing content at index 0"), and
      // chibot must save the answer before relaying `response.completed`.
      const stream = await this.#withAttachments(model, input, (input) =>
        this.#withOptional(
          model,
          {
            reasoning: {
              summary: 'auto',
              ...(plan.reasoningEffort && { effort: plan.reasoningEffort }),
            },
            ...(plan.compactThreshold !== null && {
              context_management: [
                {
                  type: 'compaction',
                  compact_threshold: plan.compactThreshold,
                },
              ],
            }),
          },
          (optional) =>
            this.#client.responses.create(
              {
                model,
                instructions,
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
    return { leafId, output, answered }
  }

  /** A title for a chat that has none yet (never a temporary one), or `null`. */
  async #titleIfNew(
    conversationId: string,
    signal: AbortSignal | undefined,
  ): Promise<string | null> {
    // Read again: the title may have been set meanwhile.
    const current = this.#store.getConversation(conversationId)!
    if (current.title !== null || current.temporary) return null
    return this.#generateTitle(conversationId, signal)
  }

  /** The items on the path to `leafId`. */
  #history(conversationId: string, leafId: number): ResponseInputItem[] {
    return this.#store.getPath(conversationId, leafId).map((item) => item.data)
  }

  /**
   * Function calls without an output on the path to `leafId` (by default
   * the current leaf). Every call is answered before the next request,
   * except calls waiting for the user's approval, so these end the path.
   */
  waitingCalls(
    conversationId: string,
    leafId?: number,
  ): ResponseFunctionToolCall[] {
    const path = this.#store
      .getPath(conversationId, leafId)
      .map((item) => item.data)
    const answered = new Set(
      path.flatMap((item) =>
        item.type === 'function_call_output' ? [item.call_id] : [],
      ),
    )
    return path.filter(
      (item): item is ResponseFunctionToolCall =>
        item.type === 'function_call' && !answered.has(item.call_id),
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

  /**
   * Names the chat again from its first messages, replacing its title
   * (also one the user typed). Null if the model gave none.
   */
  regenerateTitle(
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    return this.#generateTitle(conversationId, signal, true)
  }

  /**
   * Every tool, for Settings and the composer (whether it's switched off is
   * the `disabledTools` setting; one that needs setup says what).
   */
  get tools(): ToolInfo[] {
    return sortTools(this.#tools.tools.map((tool) => tool.info))
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

  /** Names the conversation from its opening messages. Never throws. */
  async #generateTitle(
    conversationId: string,
    signal?: AbortSignal,
    replace = false,
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

/** Resolves when `promise` does, or after `ms`, whichever comes first. */
async function untilOrTimeout(promise: Promise<void>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    promise,
    new Promise((resolve) => (timer = setTimeout(resolve, ms))),
  ])
  clearTimeout(timer)
}
