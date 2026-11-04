import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Data from `load` (a stable function: wrap it in `useCallback`), loaded
 * while `active` and reloaded after each `act`. Failures land in `error`
 * rather than being thrown, so callers never catch.
 */
export function useLoad<T>(load: () => Promise<T>, active = true) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const currentLoad = useRef(load)
  const loadedLoad = useRef(load)
  currentLoad.current = load

  // Ignore the previous loader's data while the new one is loading.
  const current = loadedLoad.current === load

  const reload = useCallback(async () => {
    if (load !== currentLoad.current) return
    const request = ++generation.current
    try {
      const next = await load()
      if (request !== generation.current || load !== currentLoad.current) return
      loadedLoad.current = load
      setData(next)
      setError(null)
    } catch (err) {
      if (request !== generation.current || load !== currentLoad.current) return
      if (loadedLoad.current !== load) setData(undefined)
      loadedLoad.current = load
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
        if (load === currentLoad.current) setError((err as Error).message)
        return false
      }
    },
    [load, reload],
  )

  return {
    data: current ? data : undefined,
    error: current ? error : null,
    reload,
    act,
  }
}
