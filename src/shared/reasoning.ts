// Kept apart from settings.ts so the web can import it without zod.

/** The SDK's reasoning efforts (`ReasoningEffort`, minus `null`). */
export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
