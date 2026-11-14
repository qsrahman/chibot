import { useEffect, useState } from 'react'
import { useAnswerRun, type ChatOptions } from './useAnswerRun.ts'
import { useChatHistory } from './useChatHistory.ts'
import { useCompaction } from './useCompaction.ts'

/**
 * Chat state for the conversation on screen: the history loaded from the
 * server (`useChatHistory`), answers being asked for and streamed
 * (`useAnswerRun`) and summaries of a long chat (`useCompaction`), put
 * together. They share the page's one error, and the chat they are all for.
 */
export function useChat(
  conversationId: string | undefined,
  options: ChatOptions,
) {
  const [error, setError] = useState<string | null>(null)
  const history = useChatHistory(conversationId)
  const compaction = useCompaction(conversationId, history, setError)
  const answers = useAnswerRun(
    conversationId,
    options,
    history,
    compaction,
    setError,
  )

  useEffect(() => {
    if (conversationId && conversationId === answers.createdId.current) {
      answers.createdId.current = null
      return
    }
    history.leave()
    answers.leave()
    compaction.leave()
    setError(null)
    if (!conversationId) return
    return history.open(conversationId, setError)
  }, [conversationId])

  const { pending } = answers
  // While a turn is pending, the turns it replaces are hidden.
  const shown = pending ? history.turns.slice(0, pending.keep) : history.turns

  return {
    turns: shown,
    pending,
    usage: history.usage,
    error,
    summarizing: compaction.summarizing,
    notice: compaction.notice,
    isTemporary:
      history.temporaryId !== null && history.temporaryId === conversationId,
    /** The project of the conversation on screen, if any. */
    projectId: history.projectId,
    busy: pending !== null || compaction.summarizing,
    /** A saved chat with messages (the server says when there is nothing to summarize). */
    canCompact: conversationId !== undefined && history.turns.length > 0,
    /** The chat's title as loaded or generated (`null`: untitled). */
    title: history.title,
    /** The chat's history hasn't arrived yet. */
    loading:
      conversationId !== undefined && history.loadedId !== conversationId,
    /** The message waiting for the current answer, if any. */
    queued: answers.queued,
    send: answers.send,
    edit: answers.edit,
    regenerate: answers.regenerate,
    approve: answers.approve,
    switchVersion: (itemId: number) => history.switchVersion(itemId, setError),
    compact: compaction.compact,
    undo: compaction.undo,
    stop() {
      answers.stop()
      compaction.stop()
    },
    enqueue: answers.enqueue,
    takeQueued: answers.takeQueued,
    cancelQueued: answers.cancelQueued,
  }
}
