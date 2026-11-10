/** The message of anything that was thrown (`catch` gives `unknown`). */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)
