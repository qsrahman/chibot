const DRAFTS_KEY = 'chibot.drafts'

// Storage can throw (private windows, blocked site data). Drafts are a
// convenience, so they just aren't kept then.
export function loadDrafts(): Record<string, string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}')
    if (!stored || typeof stored !== 'object') return {}
    return Object.fromEntries(
      Object.entries(stored).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  } catch {
    return {}
  }
}

export function saveDrafts(texts: Record<string, string>): void {
  // Sent or cleared drafts are dropped, so the store doesn't grow.
  const kept = Object.entries(texts).filter(([, text]) => text.trim() !== '')
  try {
    if (kept.length === 0) localStorage.removeItem(DRAFTS_KEY)
    else
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // Not kept this time.
  }
}
