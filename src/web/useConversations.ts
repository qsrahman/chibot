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

  const update = useCallback(
    async (id: string, patch: ConversationPatch) => {
      await updateConversation(id, patch)
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteConversation(id)
      await refresh()
    },
    [refresh],
  )

  return { conversations, error, refresh, update, remove }
}

export type ConversationsApi = ReturnType<typeof useConversations>
