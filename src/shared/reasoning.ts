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
