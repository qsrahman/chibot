// The numbers that keep a chat inside the model's context window, for the
// server (when to summarize) and the web (the meter). Zod-free, like reasoning.ts.
// The names are the settings', so `Settings` can be passed as it is.

export interface ContextLimits {
  /** Tokens the model reads at most. */
  contextWindow: number
  /** Percent of the window at which chibot compacts. */
  compactAt: number
  /** Tokens left free for the answer, tools and instructions. */
  compactReserve: number
  /** Tokens of the newest messages that stay verbatim. */
  keepRecent: number
}

/**
 * The context size at which a chat is compacted: the share of the window, or
 * what is left after the reserve, whichever is lower; never under a quarter
 * of the window, or a reserve as big as the window would summarize every
 * request.
 */
export function triggerAt({
  contextWindow,
  compactAt,
  compactReserve,
}: ContextLimits) {
  return Math.max(
    Math.floor(contextWindow / 4),
    Math.min(
      Math.floor((contextWindow * compactAt) / 100),
      contextWindow - compactReserve,
    ),
  )
}
