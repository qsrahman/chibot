import { useCallback, useRef, useState } from 'react'
import { CHAT_PAGE } from '../../shared/list.ts'
import type { ConversationPatch } from '../../shared/types.ts'
import {
  deleteConversation,
  listConversations,
  regenerateTitle,
  updateConversation,
} from './api.ts'
import { useLoad } from '../ui/useLoad.ts'

/** Shown for conversations that have no title yet. */
export const UNTITLED = 'New chat'

/** The sidebar's conversation list and the actions that change it. */
export function useConversations() {
  // How many chats are loaded; "Show more" raises it. The loader stays the
  // same function (reading the limit from a ref), so showing more keeps the
  // list on screen instead of emptying it while it loads.
  const limitRef = useRef(CHAT_PAGE)
  // The limit the list on screen was loaded with (a button that waits for it
  // would vanish while the next page loads).
  const [loadedLimit, setLoadedLimit] = useState(CHAT_PAGE)
  const { data, error, reload, act } = useLoad(
    useCallback(() => listConversations({ limit: limitRef.current }), []),
  )

  const showMore = useCallback(async () => {
    limitRef.current += CHAT_PAGE
    await reload()
    setLoadedLimit(limitRef.current)
  }, [reload])

  const update = useCallback(
    (id: string, patch: ConversationPatch) =>
      act(() => updateConversation(id, patch)),
    [act],
  )

  const retitle = useCallback(
    (id: string) => act(() => regenerateTitle(id)),
    [act],
  )

  const remove = useCallback(
    (id: string) => act(() => deleteConversation(id)),
    [act],
  )

  return {
    conversations: data ?? [],
    /** Whether the first load has finished (an empty list means none, not "not yet"). */
    loaded: data !== undefined,
    /** A full page came back, so there may be older chats not loaded yet. */
    hasMore: (data?.length ?? 0) >= loadedLimit,
    showMore,
    error,
    refresh: reload,
    update,
    retitle,
    remove,
  }
}

export type ConversationsApi = ReturnType<typeof useConversations>
