import { useEffect, useRef, useState } from 'react'
import {
  createConversation,
  deleteConversation,
  getConversation,
  streamTurn,
} from './api.ts'
import { toChatMessages, type ChatMessage } from './messages.ts'

interface Pending {
  user: string
  assistant: string
}

interface Options {
  /** With no conversation yet, the first `send` creates one and reports it. */
  onCreated: (id: string) => void
  /** The sidebar list should reload (new chat, new title). */
  onListChanged: () => void
  /** Whether a conversation created by `send` is temporary. */
  temporary: boolean
}

/** A message being answered. */
interface Turn {
  controller: AbortController
  /** The answer is complete and saved; only the title may still arrive. */
  answered: boolean
}

/** Chat state for the conversation on screen. */
export function useChat(
  conversationId: string | undefined,
  { onCreated, onListChanged, temporary }: Options,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isTemporary, setIsTemporary] = useState(false)
  // The turn whose updates belong on screen. Cleared when the user switches
  // chats, so a turn still running for the old chat can't touch the new one.
  const turnRef = useRef<Turn | null>(null)
  // Set by `send` when it creates a conversation, so the navigation to its
  // URL keeps the turn running and doesn't reload over the streaming answer.
  const createdIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (conversationId && conversationId === createdIdRef.current) {
      createdIdRef.current = null
      return
    }
    // Leaving a chat mid-answer counts as Stop: the server keeps the partial
    // answer. After the answer, the turn just stops updating the screen.
    const turn = turnRef.current
    if (turn && !turn.answered) turn.controller.abort()
    turnRef.current = null
    setPending(null)
    setError(null)
    if (!conversationId) {
      setMessages([])
      setIsTemporary(false)
      return
    }
    let current = true
    getConversation(conversationId).then(
      ({ conversation, items }) => {
        if (!current) return
        setMessages(toChatMessages(items))
        setIsTemporary(conversation.temporary)
      },
      (err: Error) => current && setError(err.message),
    )
    return () => {
      current = false
    }
  }, [conversationId])

  // A temporary chat is deleted as soon as the user leaves it: another chat,
  // a new chat, or closing/reloading the tab. The server also sweeps any
  // leftovers at startup.
  useEffect(() => {
    if (!conversationId || !isTemporary) return
    const discard = () =>
      void deleteConversation(conversationId, { keepalive: true }).catch(
        () => {},
      )
    window.addEventListener('pagehide', discard)
    return () => {
      window.removeEventListener('pagehide', discard)
      discard()
    }
  }, [conversationId, isTemporary])

  async function send(text: string) {
    const turn: Turn = { controller: new AbortController(), answered: false }
    turnRef.current = turn
    const live = () => turnRef.current === turn
    const showHistory = async (id: string) => {
      const { items } = await getConversation(id)
      if (live()) setMessages(toChatMessages(items))
    }

    setError(null)
    setPending({ user: text, assistant: '' })
    let assistant = ''
    let id = conversationId
    try {
      if (!id) {
        const created = await createConversation({ temporary })
        id = created.id
        if (!created.temporary) onListChanged()
        if (!live()) return
        createdIdRef.current = id
        setIsTemporary(created.temporary)
        onCreated(id)
      }
      for await (const event of streamTurn(id, text, turn.controller.signal)) {
        // The sidebar shows every chat, so a title is news even after the
        // user has moved on. Everything else only matters while on screen.
        if (event.type === 'chibot.title') onListChanged()
        if (!live()) continue
        if (event.type === 'response.output_text.delta') {
          assistant += event.delta
          setPending({ user: text, assistant })
        } else if (
          event.type === 'response.completed' ||
          event.type === 'response.incomplete'
        ) {
          // Saved by now. The stream may stay open a little longer for the
          // title, but the chat is free again.
          turn.answered = true
          await showHistory(id)
          if (live()) setPending(null)
        } else if (event.type === 'chibot.error') {
          setError(
            [event.message, event.requestId && `(request ${event.requestId})`]
              .filter(Boolean)
              .join(' '),
          )
        } else if (event.type === 'response.failed') {
          setError(event.response.error?.message ?? 'The response failed.')
        } else if (event.type === 'error') {
          setError(event.message)
        }
      }
      if (live() && !turn.answered) await showHistory(id)
    } catch (err) {
      if (!live() || turn.answered) return
      if (turn.controller.signal.aborted) {
        // The server keeps the partial answer. Show it without reloading,
        // because the save may not have landed yet.
        setMessages((prev) => [
          ...prev,
          { key: crypto.randomUUID(), role: 'user', text },
          ...(assistant
            ? [
                {
                  key: crypto.randomUUID(),
                  role: 'assistant' as const,
                  text: assistant,
                },
              ]
            : []),
        ])
      } else {
        setError((err as Error).message)
        if (id) await showHistory(id).catch(() => {})
      }
    } finally {
      if (live()) {
        turnRef.current = null
        setPending(null)
      }
    }
  }

  function stop() {
    const turn = turnRef.current
    if (turn && !turn.answered) turn.controller.abort()
  }

  return {
    messages,
    pending,
    error,
    isTemporary,
    busy: pending !== null,
    send,
    stop,
  }
}
