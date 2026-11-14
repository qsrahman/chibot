import { useEffect, useRef, useState } from 'react'
import type { ResponseUsage } from 'openai/resources/responses/responses'
import type { ConversationWithItems } from '../../shared/types.ts'
import { errorMessage } from '../../shared/errors.ts'
import { deleteConversation, getConversation } from '../conversations/api.ts'
import { switchVersion as putVersion } from './api.ts'
import { toTurns, type Turn } from './turns.ts'

/**
 * The conversation on screen: its turns, title, usage and where it belongs,
 * loaded from the server. `useChat` puts it together with the hooks that
 * change it (an answer being streamed, a summary being made).
 */
export function useChatHistory(conversationId: string | undefined) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [usage, setUsage] = useState<ResponseUsage | null>(null)
  const [temporaryId, setTemporaryId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  // The chat whose history last arrived (or failed to). Compared during
  // render, so a chat being opened never shows as an empty new chat.
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  // Counts the times the user has opened another chat, so a request made for
  // one chat can tell it has been left (`sameChat`).
  const loadGeneration = useRef(0)
  // Of the version switches, only the newest shows its result.
  const versionRequest = useRef(0)

  /** The number of turns now on screen. */
  const showItems = ({ items, compactions, usage }: ConversationWithItems) => {
    const shown = toTurns(items, compactions)
    setTurns(shown)
    setUsage(usage)
    return shown.length
  }

  /** Tells, later, whether the user is still on the chat they are on now. */
  const sameChat = () => {
    const generation = loadGeneration.current
    return () => generation === loadGeneration.current
  }

  /**
   * Loads chat `id` again and shows it if `wanted` still says so when it
   * arrives (the caller made it before starting any request, see `sameChat`).
   * Returns the number of turns shown, or `null` when it was not shown.
   */
  async function reload(id: string, wanted: () => boolean) {
    const loaded = await getConversation(id)
    return wanted() ? showItems(loaded) : null
  }

  /** Forgets the chat on screen: the user opened another, or a new one. */
  function leave() {
    loadGeneration.current += 1
    setTurns([])
    setUsage(null)
    setTemporaryId(null)
    setProjectId(null)
    setLoadedId(null)
    setTitle(null)
  }

  /**
   * Loads chat `id` for the screen; `onError` gets what went wrong. Returns
   * what stops it from showing if the user has moved on by then.
   */
  function open(id: string, onError: (message: string) => void) {
    let current = true
    getConversation(id).then(
      (loaded) => {
        if (!current) return
        try {
          showItems(loaded)
        } catch (err) {
          // An item the page can't read (an import from elsewhere): say so,
          // rather than leaving the chat blank.
          onError(`This chat could not be displayed: ${errorMessage(err)}`)
          setLoadedId(id)
          return
        }
        setLoadedId(id)
        const { conversation } = loaded
        setTitle(conversation.title)
        setTemporaryId(conversation.temporary ? id : null)
        setProjectId(conversation.projectId)
      },
      (err: Error) => {
        if (!current) return
        onError(err.message)
        setLoadedId(id)
      },
    )
    return () => {
      current = false
    }
  }

  /** A chat the first message created, now the one on screen. */
  function adopt(created: {
    id: string
    temporary: boolean
    projectId: string | null
  }) {
    setLoadedId(created.id)
    setTemporaryId(created.temporary ? created.id : null)
    setProjectId(created.projectId)
  }

  /** Makes version `itemId` the one shown, and loads the chat as it now is. */
  async function switchVersion(
    itemId: number,
    onError: (message: string) => void,
  ) {
    if (!conversationId) return
    const id = conversationId
    const request = ++versionRequest.current
    const same = sameChat()
    const wanted = () => same() && request === versionRequest.current
    try {
      await putVersion(id, itemId)
      await reload(id, wanted)
    } catch (err) {
      if (wanted()) onError(errorMessage(err))
    }
  }

  // A temporary chat is deleted as soon as the user leaves it: another chat,
  // a new chat, or closing/reloading the tab. The server also sweeps any
  // leftovers at startup.
  useEffect(() => {
    // The id loaded as temporary, not merely the current URL: those differ
    // while the next chat is loading, and deleting the next chat would lose it.
    if (!temporaryId || temporaryId !== conversationId) return
    const discard = () =>
      void deleteConversation(temporaryId, { keepalive: true }).catch(() => {})
    window.addEventListener('pagehide', discard)
    return () => {
      window.removeEventListener('pagehide', discard)
      discard()
    }
  }, [conversationId, temporaryId])

  return {
    turns,
    setTurns,
    usage,
    title,
    setTitle,
    projectId,
    temporaryId,
    loadedId,
    sameChat,
    reload,
    leave,
    open,
    adopt,
    switchVersion,
  }
}

export type ChatHistory = ReturnType<typeof useChatHistory>
