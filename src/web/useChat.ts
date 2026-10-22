import { useEffect, useRef, useState } from 'react'
import type { ResponseUsage } from 'openai/resources/responses/responses'
import type { TurnRequest } from '../shared/types.ts'
import {
  createConversation,
  deleteConversation,
  getConversation,
  streamTurn,
  switchVersion as putVersion,
} from './api.ts'
import { toTurns, type Question, type Turn } from './turns.ts'

/** A turn being answered, shown after the first `keep` turns. */
interface Pending {
  keep: number
  question: Question
  answer: string
}

interface Options {
  /** With no conversation yet, the first `send` creates one and reports it. */
  onCreated: (id: string) => void
  /** The sidebar list should reload (new chat, new title). */
  onListChanged: () => void
  /** Whether a conversation created by `send` is temporary. */
  temporary: boolean
}

/** A request being answered. */
interface Run {
  controller: AbortController
  /** The answer is complete and saved; only the title may still arrive. */
  answered: boolean
}

/** Chat state for the conversation on screen. */
export function useChat(
  conversationId: string | undefined,
  { onCreated, onListChanged, temporary }: Options,
) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [usage, setUsage] = useState<ResponseUsage | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isTemporary, setIsTemporary] = useState(false)
  // The run whose updates belong on screen. Cleared when the user switches
  // chats, so a run still going for the old chat can't touch the new one.
  const runRef = useRef<Run | null>(null)
  // Set by `send` when it creates a conversation, so the navigation to its
  // URL keeps the run going and doesn't reload over the streaming answer.
  const createdIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (conversationId && conversationId === createdIdRef.current) {
      createdIdRef.current = null
      return
    }
    // Leaving a chat mid-answer counts as Stop: the server keeps the partial
    // answer. After the answer, the run just stops updating the screen.
    const run = runRef.current
    if (run && !run.answered) run.controller.abort()
    runRef.current = null
    setPending(null)
    setError(null)
    if (!conversationId) {
      setTurns([])
      setUsage(null)
      setIsTemporary(false)
      return
    }
    let current = true
    getConversation(conversationId).then(
      ({ conversation, items, usage }) => {
        if (!current) return
        setTurns(toTurns(items))
        setUsage(usage)
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

  /** Sends `request`, showing `question` after the first `keep` turns. */
  async function run(
    request: TurnRequest,
    display: { keep: number; question: Question },
  ) {
    const run: Run = { controller: new AbortController(), answered: false }
    runRef.current = run
    const live = () => runRef.current === run
    const showHistory = async (id: string) => {
      const { items, usage } = await getConversation(id)
      if (!live()) return
      setTurns(toTurns(items))
      setUsage(usage)
    }

    setError(null)
    setPending({ ...display, answer: '' })
    let answer = ''
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
      for await (const event of streamTurn(
        id,
        request,
        run.controller.signal,
      )) {
        // The sidebar shows every chat, so a title is news even after the
        // user has moved on. Everything else only matters while on screen.
        if (event.type === 'chibot.title') onListChanged()
        if (!live()) continue
        if (event.type === 'response.output_text.delta') {
          answer += event.delta
          setPending({ ...display, answer })
        } else if (
          event.type === 'response.completed' ||
          event.type === 'response.incomplete'
        ) {
          // Saved by now. The stream may stay open a little longer for the
          // title, but the chat is free again.
          run.answered = true
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
      if (live() && !run.answered) await showHistory(id)
    } catch (err) {
      if (!live() || run.answered) return
      if (run.controller.signal.aborted) {
        // The server keeps the partial answer. Show it without reloading,
        // because the save may not have landed yet. Without item ids its
        // actions stay hidden until the next reload.
        setTurns((prev) => [
          ...prev.slice(0, display.keep),
          {
            key: crypto.randomUUID(),
            question: display.question,
            answer: answer
              ? {
                  itemId: null,
                  text: answer,
                  usage: null,
                  model: null,
                  versions: null,
                }
              : null,
          },
        ])
      } else {
        setError((err as Error).message)
        if (id) await showHistory(id).catch(() => {})
      }
    } finally {
      if (live()) {
        runRef.current = null
        setPending(null)
      }
    }
  }

  const newQuestion = (text: string, parentId: number | null): Question => ({
    itemId: null,
    parentId,
    text,
    versions: null,
  })

  /** Sends a new message after the last turn. */
  function send(text: string) {
    return run(
      { text },
      { keep: turns.length, question: newQuestion(text, null) },
    )
  }

  /** Replaces the question of turn `index` with `text` as a new version. */
  function edit(index: number, text: string) {
    const { parentId } = turns[index]!.question
    return run(
      { text, parentId },
      { keep: index, question: newQuestion(text, parentId) },
    )
  }

  /** Answers the question of turn `index` again, as a new version. */
  function regenerate(index: number) {
    const { question } = turns[index]!
    return run({ parentId: question.itemId! }, { keep: index, question })
  }

  async function switchVersion(itemId: number) {
    if (!conversationId) return
    try {
      await putVersion(conversationId, itemId)
      const { items, usage } = await getConversation(conversationId)
      setTurns(toTurns(items))
      setUsage(usage)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function stop() {
    const run = runRef.current
    if (run && !run.answered) run.controller.abort()
  }

  // While a turn is pending, the turns it replaces are hidden.
  const shown = pending ? turns.slice(0, pending.keep) : turns

  return {
    turns: shown,
    pending,
    usage,
    error,
    isTemporary,
    busy: pending !== null,
    send,
    edit,
    regenerate,
    switchVersion,
    stop,
  }
}
