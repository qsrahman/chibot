/** A tool call's JSON (its arguments or output) as an object; `{}` when it isn't one. */
export function parseJson<T extends object>(text: string): Partial<T> {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' ? (value as T) : {}
  } catch {
    return {}
  }
}
