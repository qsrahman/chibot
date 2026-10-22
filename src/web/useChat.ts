import { useCallback, useEffect, useRef, useState } from 'react'
import { createConversation, getConversation, streamTurn } from './api.ts'
import { toChatMessages, type ChatMessage } from './messages.ts'

interface Pending {
  user: string
  assistant: string
}

/**
 * Chat state for one conversation. With no `conversationId`, the first
 * `send` creates a conversation and reports its id through `onCreated`.
 */
export function useChat(
  conversationId: string | undefined,
  onCreated: (id: string) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The id `send` just created. Its history is already on screen, and
  // reloading it would wipe the answer that's streaming in.
  const createdIdRef = useRef<string | null>(null)

  const reload = useCallback(async (id: string) => {
    setMessages(toChatMessages((await getConversation(id)).items))
  }, [])

  useEffect(() => {
    setError(null)
    if (!conversationId) {
      setMessages([])
      return
    }
    if (conversationId === createdIdRef.current) return
    reload(conversationId).catch((err: Error) => setError(err.message))
  }, [conversationId, reload])

  async function send(text: string) {
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    setPending({ user: text, assistant: '' })
    let assistant = ''
    let id = conversationId
    try {
      if (!id) {
        id = (await createConversation()).id
        createdIdRef.current = id
        onCreated(id)
      }
      for await (const event of streamTurn(id, text, controller.signal)) {
        if (event.type === 'response.output_text.delta') {
          assistant += event.delta
          setPending({ user: text, assistant })
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
      // The server saves the turn before the stream ends.
      await reload(id)
    } catch (err) {
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
      abortRef.current = null
      setPending(null)
    }
  }

  const stop = () => abortRef.current?.abort()

  return { messages, pending, error, busy: pending !== null, send, stop }
}
