import { useRef, useState } from 'react'
import type { Compaction, TurnCompactionEvent } from '../../shared/types.ts'
import { errorMessage } from '../../shared/errors.ts'
import { compactChat, undoCompaction } from './api.ts'
import type { ChatHistory } from './useChatHistory.ts'

/**
 * Summaries of a long chat's earlier messages: one being made (before an
 * answer, or on request), the note when one failed, and Undo.
 */
export function useCompaction(
  conversationId: string | undefined,
  { reload, sameChat }: Pick<ChatHistory, 'reload' | 'sameChat'>,
  setError: (message: string | null) => void,
) {
  // Earlier messages are being summarized.
  const [summarizing, setSummarizing] = useState(false)
  // A one-line note that is not an error (a summary that failed).
  const [notice, setNotice] = useState<string | null>(null)
  const compacting = useRef<AbortController | null>(null)

  /** The user left the chat: nothing of it is being summarized any more. */
  function leave() {
    setSummarizing(false)
    setNotice(null)
    compacting.current?.abort()
  }

  /** Stop: a request for a summary is given up. */
  function stop() {
    compacting.current?.abort()
  }

  /** What an answer's request says about summarizing before it. */
  function onEvent(event: TurnCompactionEvent) {
    setSummarizing(event.status === 'started')
    setNotice(
      event.status === 'failed'
        ? `Couldn’t summarize earlier messages (${event.message}). Continuing with the full history.`
        : null,
    )
  }

  /** Summarizes the start of the chat now, with an optional `focus`. */
  async function compact(focus: string) {
    if (!conversationId) return
    const id = conversationId
    const same = sameChat()
    const controller = new AbortController()
    compacting.current = controller
    setError(null)
    setNotice(null)
    setSummarizing(true)
    try {
      await compactChat(id, focus, controller.signal)
      await reload(id, same)
    } catch (err) {
      if (!controller.signal.aborted && same()) {
        setError(errorMessage(err))
      }
    } finally {
      if (compacting.current === controller) {
        compacting.current = null
        setSummarizing(false)
      }
    }
  }

  /** Undo: brings back the messages a summary stood for. */
  async function undo(compaction: Compaction) {
    if (!conversationId) return
    const id = conversationId
    const same = sameChat()
    try {
      await undoCompaction(id, compaction.id)
      await reload(id, same)
    } catch (err) {
      if (same()) setError(errorMessage(err))
    }
  }

  return {
    summarizing,
    setSummarizing,
    notice,
    leave,
    stop,
    onEvent,
    compact,
    undo,
  }
}

export type Compacting = ReturnType<typeof useCompaction>
