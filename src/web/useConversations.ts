import { useCallback, useEffect, useState } from 'react'
import type {
  ConversationListItem,
  ConversationPatch,
} from '../shared/types.ts'
import {
  deleteConversation,
  listConversations,
  updateConversation,
} from './api.ts'

/** Shown for conversations that have no title yet. */
export const UNTITLED = 'New chat'

/** The sidebar's conversation list and the actions that change it. */
export function useConversations() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setConversations(await listConversations())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Actions report failure through `error` (shown in the sidebar) and their
  // result, so callers never have to catch.
  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      try {
        await action()
        await refresh()
        return true
      } catch (err) {
        // Resync first (the list may be stale, e.g. a chat deleted elsewhere),
        // then show the error, which a successful refresh would clear.
        await refresh()
        setError((err as Error).message)
        return false
      }
    },
    [refresh],
  )

  const update = useCallback(
    (id: string, patch: ConversationPatch) =>
      run(() => updateConversation(id, patch)),
    [run],
  )

  const remove = useCallback(
    (id: string) => run(() => deleteConversation(id)),
    [run],
  )

  return { conversations, error, refresh, update, remove }
}

export type ConversationsApi = ReturnType<typeof useConversations>
