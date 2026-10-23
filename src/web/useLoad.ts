import { useCallback, useEffect, useState } from 'react'

/**
 * Data from `load` (a stable function: wrap it in `useCallback`), loaded
 * while `active` and reloaded after each `act`. Failures land in `error`
 * rather than being thrown, so callers never catch.
 */
export function useLoad<T>(load: () => Promise<T>, active = true) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setData(await load())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [load])

  useEffect(() => {
    if (active) void reload()
  }, [active, reload])

  /** Runs `action`, then reloads; resolves to whether `action` worked. */
  const act = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      try {
        await action()
        await reload()
        return true
      } catch (err) {
        // Resync first (the data may be stale, e.g. deleted elsewhere), then
        // show the error, which a successful reload would clear.
        await reload()
        setError((err as Error).message)
        return false
      }
    },
    [reload],
  )

  return { data, error, reload, act }
}
