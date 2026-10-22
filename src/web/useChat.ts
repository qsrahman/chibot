import { useCallback, useEffect, useRef, useState } from 'react'
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

/** Chat state for one conversation. */
export function useChat(
  conversationId: string | undefined,
  { onCreated, onListChanged, temporary }: Options,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isTemporary, setIsTemporary] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // The id `send` just created. Its history is already on screen, and
  // reloading it would wipe the answer that's streaming in.
  const createdIdRef = useRef<string | null>(null)

  const reload = useCallback(async (id: string) => {
    const { conversation, items } = await getConversation(id)
    setMessages(toChatMessages(items))
    setIsTemporary(conversation.temporary)
  }, [])

  useEffect(() => {
    setError(null)
    if (!conversationId) {
      setMessages([])
      setIsTemporary(false)
      return
    }
    if (conversationId === createdIdRef.current) return
    reload(conversationId).catch((err: Error) => setError(err.message))
  }, [conversationId, reload])

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
      abortRef.current?.abort()
      discard()
    }
  }, [conversationId, isTemporary])

  async function send(text: string) {
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    setPending({ user: text, assistant: '' })
    let assistant = ''
    let finished = false
    let id = conversationId
    try {
      if (!id) {
        const created = await createConversation({ temporary })
        id = created.id
        createdIdRef.current = id
        setIsTemporary(created.temporary)
        onCreated(id)
        if (!created.temporary) onListChanged()
      }
      for await (const event of streamTurn(id, text, controller.signal)) {
        if (event.type === 'response.output_text.delta') {
          assistant += event.delta
          setPending({ user: text, assistant })
        } else if (
          event.type === 'response.completed' ||
          event.type === 'response.incomplete'
        ) {
          // The answer is saved by now. The stream may stay open a little
          // longer for the title, but the chat is free again.
          finished = true
          await reload(id)
          setPending(null)
          abortRef.current = null
        } else if (event.type === 'chibot.title') {
          onListChanged()
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
      if (!finished) await reload(id)
    } catch (err) {
      if (finished) return // e.g. the user left while the title was coming
      if (controller.signal.aborted) {
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
        if (id) await reload(id).catch(() => {})
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setPending(null)
    }
  }

  const stop = () => abortRef.current?.abort()

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
