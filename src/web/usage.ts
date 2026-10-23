import type { ResponseUsage } from 'openai/resources/responses/responses'

const compact = new Intl.NumberFormat(undefined, { notation: 'compact' })
const full = new Intl.NumberFormat()

export interface UsageLabel {
  /** e.g. "1.2K tokens" */
  short: string
  /** e.g. "Input 1,180 (cached 512) · Output 64 (reasoning 20)" */
  detail: string
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
