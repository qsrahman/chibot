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
