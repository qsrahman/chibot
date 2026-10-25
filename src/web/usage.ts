import type { ResponseUsage } from 'openai/resources/responses/responses'

const compact = new Intl.NumberFormat(undefined, { notation: 'compact' })
const full = new Intl.NumberFormat()

export interface UsageLabel {
  /** e.g. "1.2K tokens" */
  short: string
  /** e.g. "Input 1,180 (cached 512) · Output 64 (reasoning 20)" */
  detail: string
}

/** How much of the compaction threshold an answer's context used. */
export interface ContextLabel {
  /** e.g. "12.4K / 64K context" */
  short: string
  /** What was sent, and when chibot compacts. */
  detail: string
  /** At least 80 % of the threshold: compaction is close. */
  nearLimit: boolean
}

/**
 * Describes token usage, or `null` when there's none to show. Compatible
 * servers may omit the detail fields, so they're treated as optional.
 */
export function describeUsage(
  usage: ResponseUsage | null | undefined,
): UsageLabel | null {
  if (!usage?.total_tokens) return null
  const cached = usage.input_tokens_details?.cached_tokens
  const reasoning = usage.output_tokens_details?.reasoning_tokens
  const input =
    `Input ${full.format(usage.input_tokens)}` +
    (cached ? ` (cached ${full.format(cached)})` : '')
  const output =
    `Output ${full.format(usage.output_tokens)}` +
    (reasoning ? ` (reasoning ${full.format(reasoning)})` : '')
  return {
    short: `${compact.format(usage.total_tokens)} tokens`,
    detail: `${input} · ${output}`,
  }
}

/**
 * Describes the context an answer sent against the compaction threshold, or
 * `null` when the server gave no input count. The input is the context the
 * model read; the output isn't part of it.
 */
export function describeContext(
  usage: ResponseUsage | null | undefined,
  threshold: number | null,
): ContextLabel | null {
  const input = usage?.input_tokens
  if (!input) return null
  if (threshold === null) {
    return {
      short: `${compact.format(input)} context`,
      detail: `${full.format(input)} tokens of context sent with this answer. Compaction is off (Settings → Model).`,
      nearLimit: false,
    }
  }
  return {
    short: `${compact.format(input)} / ${compact.format(threshold)} context`,
    detail: `${full.format(input)} of ${full.format(threshold)} tokens of context sent with this answer. chibot compacts older turns past that (Settings → Model).`,
    nearLimit: input >= threshold * 0.8,
  }
}

/**
 * `a` plus `b`, for answers made of several responses (tool calls). Missing
 * detail fields count as 0.
 */
export function addUsage(
  a: ResponseUsage | null,
  b: ResponseUsage,
): ResponseUsage {
  if (!a) return b
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    input_tokens_details: {
      cached_tokens:
        (a.input_tokens_details?.cached_tokens ?? 0) +
        (b.input_tokens_details?.cached_tokens ?? 0),
      cache_write_tokens:
        (a.input_tokens_details?.cache_write_tokens ?? 0) +
        (b.input_tokens_details?.cache_write_tokens ?? 0),
    },
    output_tokens: a.output_tokens + b.output_tokens,
    output_tokens_details: {
      reasoning_tokens:
        (a.output_tokens_details?.reasoning_tokens ?? 0) +
        (b.output_tokens_details?.reasoning_tokens ?? 0),
    },
    total_tokens: a.total_tokens + b.total_tokens,
  }
}
