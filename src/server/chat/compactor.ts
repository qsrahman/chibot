import type { ResponseInputItem } from 'openai/resources/responses/responses'
import { messageText } from '../../shared/messages.ts'
import { limitsFrom } from '../../shared/context.ts'
import type { Compaction, StoredItem } from '../../shared/types.ts'
import type { ConversationStore } from '../conversations/index.ts'
import type { SettingsStore } from '../settings-store.ts'
import {
  compactionFor,
  contextTokens,
  cutPoint,
  estimateText,
  estimateTokens,
  fromCompaction,
  isContextOverflow,
  keepTokens,
  serialize,
  summaryMessage,
} from './context.ts'
import type { ModelRequests } from './model-requests.ts'
import { SUMMARY_INSTRUCTIONS, summaryRequest } from './prompts.ts'

const SUMMARY_MAX_TOKENS = 8000
/** Room in the summarizer's window for its instructions. */
const SUMMARIZER_OVERHEAD = 2000
/** Failures in a row after which a chat stops compacting by itself. */
const FAILURES_BEFORE_PAUSE = 3
const FOCUS_MAX = 800

/** What a compaction will summarize, found before any model is asked. */
export interface CompactionJob {
  conversationId: string
  /** The summary stands in for the path up to this item. */
  upToItemId: number
  /** The compaction this one builds on, if any. */
  previous: Compaction | null
  items: StoredItem[]
  tokensBefore: number
  /** Estimated tokens of the messages that stay. */
  tokensKept: number
}

/**
 * Summarizes the start of a long chat with the chat's own model, so any
 * OpenAI-compatible server can keep chatting past its context window. The
 * summary is saved as a `Compaction`; the messages stay and Undo restores them.
 */
export class Compactor {
  readonly #model: ModelRequests
  readonly #store: ConversationStore
  readonly #settings: SettingsStore
  // Summaries that failed in a row, per chat, until one works.
  readonly #failures = new Map<string, number>()

  constructor(
    model: ModelRequests,
    store: ConversationStore,
    settings: SettingsStore,
  ) {
    this.#model = model
    this.#store = store
    this.#settings = settings
  }

  /** The compaction that applies to a path, or `null`. */
  forPath(conversationId: string, path: StoredItem[]): Compaction | null {
    return compactionFor(path, this.#store.compactions.list(conversationId))
  }

  /** The compactions that apply to the path to `leafId`, oldest first. */
  onPath(conversationId: string, path: StoredItem[]): Compaction[] {
    const ids = new Set(path.map((item) => item.id))
    return this.#store.compactions
      .list(conversationId)
      .filter((c) => ids.has(c.upToItemId))
  }

  delete(conversationId: string, id: number): boolean {
    return this.#store.compactions.delete(conversationId, id)
  }

  /** Whether automatic compaction gave up on this chat (a manual one resets it). */
  paused(conversationId: string): boolean {
    return (this.#failures.get(conversationId) ?? 0) >= FAILURES_BEFORE_PAUSE
  }

  /**
   * Finds what to summarize on the path to `leafId`, keeping the newest
   * messages (`harder` keeps half as many), or `null` when there is nothing
   * before the newest turn to summarize.
   */
  prepare(
    conversationId: string,
    leafId: number,
    { harder = false } = {},
  ): CompactionJob | null {
    const path = this.#store.getPath(conversationId, leafId)
    const previous = this.forPath(conversationId, path)
    const { items, lead } = fromCompaction(path, previous)
    const limits = limitsFrom(this.#settings.get())
    const keep = keepTokens(limits) / (harder ? 2 : 1)
    const cut = cutPoint(items, keep)
    if (cut === null) return null
    const leadTokens = lead.reduce((n, item) => n + estimateTokens(item), 0)
    return {
      conversationId,
      upToItemId: items[cut - 1]!.id,
      previous,
      items: items.slice(0, cut),
      tokensBefore: contextTokens(items, leadTokens),
      tokensKept: items
        .slice(cut)
        .reduce((n, item) => n + estimateTokens(item.data), 0),
    }
  }

  /**
   * Writes the summary and saves it. Throws when the model fails or the
   * summary doesn't pass the checks; the chat is left as it was.
   */
  async run(
    job: CompactionJob,
    { focus, signal }: { focus?: string | null; signal?: AbortSignal } = {},
  ): Promise<Compaction> {
    try {
      const compaction = await this.#summarize(job, focus ?? null, signal)
      this.#failures.delete(job.conversationId)
      return compaction
    } catch (err) {
      if (!signal?.aborted) {
        this.#failures.set(
          job.conversationId,
          (this.#failures.get(job.conversationId) ?? 0) + 1,
        )
      }
      throw err
    }
  }

  async #summarize(
    job: CompactionJob,
    focus: string | null,
    signal: AbortSignal | undefined,
  ): Promise<Compaction> {
    const { model, contextWindow } = this.#settings.get()
    const budget = Math.max(
      1000,
      contextWindow - SUMMARY_MAX_TOKENS - SUMMARIZER_OVERHEAD,
    )
    let data = job.items.map((item) => item.data)
    let transcript = serialize(data)
    // The oldest messages go first: the newest are the ones that matter.
    while (data.length > 1 && estimateText(transcript) > budget) {
      data = data.slice(Math.ceil(data.length / 4))
      transcript = serialize(data)
    }

    const request = (text: string) =>
      this.#model.complete(
        {
          model,
          instructions: SUMMARY_INSTRUCTIONS,
          input: summaryRequest(job.previous?.summary ?? null, text, focus),
          max_output_tokens: SUMMARY_MAX_TOKENS,
          store: false,
        },
        // A summary needs no thinking; models that can't turn it off ignore this.
        { reasoning: { effort: 'none' } },
        signal,
      )
    let response
    try {
      response = await request(transcript)
    } catch (err) {
      if (!isContextOverflow(err) || data.length < 2) throw err
      data = data.slice(Math.ceil(data.length / 2))
      transcript = serialize(data)
      response = await request(transcript)
    }

    if (response.status === 'incomplete') {
      throw new Error('The summary was cut off by the output limit.')
    }
    const summary = /<summary>([\s\S]*?)<\/summary>/
      .exec(response.output_text)?.[1]
      ?.trim()
    if (!summary) throw new Error('The model wrote no usable summary.')
    if (estimateText(summary) >= estimateText(transcript)) {
      throw new Error(
        'The summary is not shorter than the messages it replaces.',
      )
    }

    return this.#store.compactions.add(job.conversationId, {
      upToItemId: job.upToItemId,
      summary,
      summaryModel: response.model || model,
      tokensBefore: job.tokensBefore,
      tokensAfter: estimateTokens(summaryMessage(summary)) + job.tokensKept,
      previousId: job.previous?.id ?? null,
      degraded: lostReferences(data, summary),
    })
  }
}

/** The focus a user typed for a manual compaction, trimmed to its limit. */
export function cleanFocus(focus: string | undefined | null): string | null {
  return focus?.trim().slice(0, FOCUS_MAX) || null
}

/**
 * Whether the summary dropped something the user quoted: a `code span` or a
 * link in their messages. It is kept anyway and marked, since the original
 * messages are one Undo away.
 */
function lostReferences(items: ResponseInputItem[], summary: string): boolean {
  const quoted = items.flatMap((item) => {
    const message = messageText(item)
    if (message?.role !== 'user') return []
    return [
      ...message.text.matchAll(/`([^`\n]{3,120})`|(https?:\/\/[^\s)>\]]+)/g),
    ].map((m) => m[1] ?? m[2]!)
  })
  return quoted.some((reference) => !summary.includes(reference))
}
