import { useCallback, useRef, useState } from 'react'
import { CHAT_PAGE } from '../../shared/list.ts'
import { useLoad } from './useLoad.ts'

/**
 * `useLoad` for a list that loads a page of chats at a time: `load(limit)`
 * fetches the first `limit`, and `showMore` asks for another page. The loader
 * stays the same function (it reads the limit from a ref), so showing more
 * keeps the list on screen instead of emptying it while it loads.
 *
 * @param count how many chats `data` holds
 */
export function useShowMore<T>(
  load: (limit: number) => Promise<T>,
  count: (data: T) => number,
  active = true,
) {
  const limitRef = useRef(CHAT_PAGE)
  // The limit the list on screen was loaded with (a button that waited for
  // the next one would vanish while it loads).
  const [loadedLimit, setLoadedLimit] = useState(CHAT_PAGE)
  const loadRef = useRef(load)
  loadRef.current = load
  const result = useLoad(
    useCallback(() => loadRef.current(limitRef.current), []),
    active,
  )
  const { reload } = result

  const showMore = useCallback(async () => {
    limitRef.current += CHAT_PAGE
    await reload()
    setLoadedLimit(limitRef.current)
  }, [reload])

  return {
    ...result,
    /** A full page came back, so there may be older chats not loaded yet. */
    hasMore: result.data !== undefined && count(result.data) >= loadedLimit,
    showMore,
  }
}
