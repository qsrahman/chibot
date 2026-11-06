// The numbers that keep a chat inside the model's context window, for the
// server (when to summarize) and the web (the meter). Zod-free, like reasoning.ts.

export interface ContextLimits {
  /** Tokens the model reads at most. */
  window: number
  /** Percent of the window at which chibot compacts. */
  compactAt: number
  /** Tokens left free for the answer, tools and instructions. */
  reserve: number
  /** Tokens of the newest messages that stay verbatim. */
  keepRecent: number
}

/** The context size at which a chat is compacted. */
export function triggerAt({ window, compactAt, reserve }: ContextLimits) {
  return Math.max(
    1,
    Math.min(Math.floor((window * compactAt) / 100), window - reserve),
  )
}

/** The limits as the settings name them. */
export function limitsFrom(settings: {
  contextWindow: number
  compactAt: number
  compactReserve: number
  keepRecent: number
}): ContextLimits {
  return {
    window: settings.contextWindow,
    compactAt: settings.compactAt,
    reserve: settings.compactReserve,
    keepRecent: settings.keepRecent,
  }
}
