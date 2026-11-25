import { useCallback } from 'react'
import type { ConversationPatch } from '../../shared/types.ts'
import {
  deleteConversation,
  listConversations,
  regenerateTitle,
  updateConversation,
} from './api.ts'
import { useShowMore } from '../ui/useShowMore.ts'

/** Shown for conversations that have no title yet. */
export const UNTITLED = 'New chat'

/** The sidebar's conversation list and the actions that change it. */
export function useConversations() {
  const { data, error, reload, act, hasMore, showMore } = useShowMore(
    (limit) => listConversations({ limit }),
    (list) => list.length,
  )

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
    hasMore,
    showMore,
    error,
    refresh: reload,
    update,
    retitle,
    remove,
  }
}

export type ConversationsApi = ReturnType<typeof useConversations>
