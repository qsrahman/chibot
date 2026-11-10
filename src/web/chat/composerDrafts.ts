import { readStored, writeStored } from '../ui/storage.ts'

const DRAFTS_KEY = 'chibot.drafts'

export function loadDrafts(): Record<string, string> {
  try {
    const stored: unknown = JSON.parse(readStored(DRAFTS_KEY) ?? '{}')
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
  writeStored(
    DRAFTS_KEY,
    kept.length === 0 ? null : JSON.stringify(Object.fromEntries(kept)),
  )
}
