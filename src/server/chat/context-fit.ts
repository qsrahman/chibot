import type {
  FunctionTool,
  ResponseInputItem,
} from 'openai/resources/responses/responses'
import { triggerAt, type ContextLimits } from '../../shared/context.ts'
import type { TurnCompactionEvent } from '../../shared/types.ts'
import type { ConversationStore } from '../conversations/index.ts'
import type { Compactor } from './compactor.ts'
import {
  buildContext,
  prune,
  pruneSavings,
  pruningSuffices,
} from './context.ts'

/** What fitting the context needs of a turn's plan. */
export interface FitPlan {
  autoCompact: boolean
  limits: ContextLimits
  /** What the summary request shares with the chat's own requests. */
  instructions: string
  /** The tools offered, as request entries. */
  tools: FunctionTool[]
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
export async function* fitContext(
  { store, compactor }: { store: ConversationStore; compactor: Compactor },
  plan: FitPlan,
  conversationId: string,
  leafId: number,
  signal: AbortSignal | undefined,
  overflow = false,
): AsyncGenerator<TurnCompactionEvent, ResponseInputItem[] | null> {
  const { limits, autoCompact } = plan
  const build = () =>
    buildContext(
      store.getPath(conversationId, leafId),
      compactor.list(conversationId),
      limits,
      compactor.usageSince(conversationId),
    )
  let { data, keepFrom, used } = build()
  const trigger = triggerAt(limits)
  if (!overflow && used <= trigger) return data

  const saved = pruneSavings(data, keepFrom)
  if (
    !overflow &&
    pruningSuffices(saved, used, trigger, limits.contextWindow)
  ) {
    return prune(data, keepFrom)
  }
  const job =
    autoCompact && (overflow || !compactor.paused(conversationId))
      ? compactor.prepare(conversationId, leafId, { harder: overflow })
      : null
  if (job) {
    yield { type: 'chibot.compaction', status: 'started' }
    try {
      const compaction = await compactor.run(job, {
        signal,
        shared: {
          instructions: plan.instructions,
          tools: plan.tools,
          input: prune(data, keepFrom),
        },
      })
      yield { type: 'chibot.compaction', status: 'done', compaction }
      ;({ data, keepFrom } = build())
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
