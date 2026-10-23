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
