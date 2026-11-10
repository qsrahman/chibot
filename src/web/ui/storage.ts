// Browser preferences live in `localStorage`, which can throw (private
// windows, blocked site data). They are conveniences, so a failure just means
// a value is not kept or not found.

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Keeps `value`, or forgets the key for `null`. */
export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Not kept; it still applies until the page is closed.
  }
}
