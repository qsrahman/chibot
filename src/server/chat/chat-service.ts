import type {
  FunctionTool,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses'
import {
  limitsFrom,
  triggerAt,
  type ContextLimits,
} from '../../shared/context.ts'
import type { Settings } from '../../shared/settings.ts'
import type {
  Conversation,
  TurnApprovalEvent,
  TurnCompactionEvent,
  TurnRequest,
  TurnTitleEvent,
  TurnToolOutputEvent,
} from '../../shared/types.ts'
import type { Attachments } from '../attachments.ts'
import type { ConversationStore } from '../conversations/index.ts'
import type { ProjectStore } from '../projects/index.ts'
import type { SettingsStore } from '../settings-store.ts'
import type { Compactor } from './compactor.ts'
import {
  contextTokens,
  fromCompaction,
  isContextOverflow,
  prune,
  pruneSavings,
  pruningSuffices,
  tailStart,
  keepTokens,
} from './context.ts'
import type { ModelRequests } from './model-requests.ts'
import { chatInstructions } from './prompts.ts'
import type { TitleWriter } from './title-writer.ts'
import { TOOL_DENIED, ToolRegistry } from '../tool-registry.ts'

/** What `runTurn` yields. */
type TurnEvent =
  | ResponseStreamEvent
  | TurnTitleEvent
  | TurnToolOutputEvent
  | TurnApprovalEvent
  | TurnCompactionEvent

/** What a turn sends the model, fixed when it starts. */
interface TurnPlan {
  conversation: Conversation
  model: string
  reasoningEffort: Settings['reasoningEffort']
  autoCompact: boolean
  limits: ContextLimits
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
  readonly #model: ModelRequests
  readonly #titles: TitleWriter
  readonly #compactor: Compactor
  readonly #store: ConversationStore
  readonly #settings: SettingsStore
  readonly #tools: ToolRegistry
  readonly #projects: ProjectStore | null
  readonly #attachments: Attachments | null
  // Each chat's latest turn, until it has finished unwinding.
  readonly #turns = new Map<string, Promise<void>>()

  /**
   * @param options.tools offered to the model (none by default)
   * @param options.projects for project chats' instructions
   * @param options.attachments to put files attached to messages in them
   *   (`model` sends them)
   */
  constructor(
    model: ModelRequests,
    titles: TitleWriter,
    compactor: Compactor,
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
    this.#model = model
    this.#titles = titles
    this.#compactor = compactor
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
      ? await this.#titles.ifNew(conversationId, signal)
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
      autoCompact: settings.autoCompact,
      limits: limitsFrom(settings),
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
    ResponseStreamEvent | TurnCompactionEvent,
    { leafId: number; output: ResponseInputItem[] | null; answered: boolean }
  > {
    const { model, instructions, tools, forced } = plan
    let input = (yield* this.#fitContext(plan, conversationId, leafId, signal))!
    let partial = ''
    let output: ResponseInputItem[] | null = null
    let answered = false
    const send = (input: ResponseInputItem[]) =>
      this.#model.stream(
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
        },
        {
          reasoning: {
            summary: 'auto',
            ...(plan.reasoningEffort && { effort: plan.reasoningEffort }),
          },
        },
        signal,
      )
    try {
      let stream
      try {
        stream = await send(input)
      } catch (err) {
        // The estimate was too low: the server says the request is too long.
        // Summarize harder and ask once more.
        if (!plan.autoCompact || !isContextOverflow(err)) throw err
        const retry = yield* this.#fitContext(
          plan,
          conversationId,
          leafId,
          signal,
          true,
        )
        if (!retry) throw err
        input = retry
        stream = await send(input)
      }
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

  /**
   * The input for the next request. Under the trigger it is the path as it
   * is (after the newest compaction). Past it, old tool results and pictures
   * are shortened; if that is not enough, the start of the chat is summarized
   * (yielding `chibot.compaction` while the model writes it). `overflow` is
   * the recovery after the server refused a request as too long: it compacts
   * whatever the estimate says, and returns `null` if it cannot (otherwise
   * the result is never `null`).
   */
  async *#fitContext(
    plan: TurnPlan,
    conversationId: string,
    leafId: number,
    signal: AbortSignal | undefined,
    overflow = false,
  ): AsyncGenerator<TurnCompactionEvent, ResponseInputItem[] | null> {
    const { limits, autoCompact } = plan
    const build = () => {
      const path = this.#store.getPath(conversationId, leafId)
      const { items, lead } = fromCompaction(
        path,
        this.#compactor.forPath(conversationId, path),
      )
      const data = [...lead, ...items.map((item) => item.data)]
      const keepFrom = lead.length + tailStart(items, keepTokens(limits))
      return { data, keepFrom, used: contextTokens(items, lead.length) }
    }
    let { data, keepFrom, used } = build()
    const trigger = triggerAt(limits)
    if (!overflow && used <= trigger) return data

    const saved = pruneSavings(data, keepFrom)
    if (!overflow && pruningSuffices(saved, used, trigger, limits.window)) {
      return prune(data, keepFrom)
    }
    const job =
      autoCompact && (overflow || !this.#compactor.paused(conversationId))
        ? this.#compactor.prepare(conversationId, leafId, { harder: overflow })
        : null
    if (job) {
      yield { type: 'chibot.compaction', status: 'started' }
      try {
        const compaction = await this.#compactor.run(job, { signal })
        yield { type: 'chibot.compaction', status: 'done', compaction }
        ;({ data, keepFrom, used } = build())
      } catch (err) {
        signal?.throwIfAborted()
        yield {
          type: 'chibot.compaction',
          status: 'failed',
          message: err instanceof Error ? err.message : String(err),
        }
        if (overflow) return null
      }
    } else if (overflow) {
      return null
    }
    return prune(data, keepFrom)
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
