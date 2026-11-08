// Kept apart from settings.ts so the web can import it without zod.
import type { ReasoningEffort } from 'openai/resources/shared'

/** The SDK's reasoning efforts (the SDK has the type, not a list). */
export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly NonNullable<ReasoningEffort>[]

/**
 * An effort as the interface names it: `null` (the model's own default) is
 * "Auto", as in the composer's mode switch; the levels are capitalized.
 */
export function effortLabel(
  effort: ReasoningEffort | null | undefined,
): string {
  return effort ? effort[0]!.toUpperCase() + effort.slice(1) : 'Auto'
}

/** A line under each level in the effort menu. */
export const EFFORT_HINTS: Record<string, string> = {
  auto: 'The model decides how long to think',
  none: 'No reasoning',
  minimal: 'Barely thinks',
  low: 'Answers quickly',
  medium: 'Balances speed and depth',
  high: 'Thinks longer for harder questions',
  xhigh: 'Thinks even longer',
  max: 'Thinks as long as the model allows',
}

/**
 * What the interface offers: Auto (`null`) and the levels, without `none`
 * (not every model accepts it). A `none` saved earlier stays in the list while
 * it is the current value, so a menu never shows nothing chosen.
 */
export function effortChoices(
  current: ReasoningEffort | null | undefined,
): (ReasoningEffort | null)[] {
  return [
    null,
    ...REASONING_EFFORTS.filter((e) => e !== 'none' || current === 'none'),
  ]
}
