import { useEffect, useRef, useState } from 'react'
import type { ResponseUsage } from 'openai/resources/responses/responses'
import type { ConversationWithItems, TurnRequest } from '../shared/types.ts'
import {
  createConversation,
  deleteConversation,
  getConversation,
  streamTurn,
  switchVersion as putVersion,
} from './api.ts'
import {
  toTurns,
  waitingCalls,
  type Answer,
  type Attachment,
  type Question,
  type ToolActivity,
  type Turn,
} from './turns.ts'

/** The turn being answered, shown after the first `keep` turns. */
interface Pending {
  keep: number
  turn: Turn
}

interface Options {
  /** With no conversation yet, the first `send` creates one and reports it. */
  onCreated: (id: string) => void
  /** The sidebar list should reload (new chat, new title). */
  onListChanged: () => void
  /** Whether a conversation created by `send` is temporary. */
  temporary: boolean
  /** The project a conversation created by `send` goes in. */
  projectId?: string
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
  { onCreated, onListChanged, temporary, projectId: newProjectId }: Options,
) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [usage, setUsage] = useState<ResponseUsage | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [temporaryId, setTemporaryId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  // The run whose updates belong on screen. Cleared when the user switches
  // chats, so a run still going for the old chat can't touch the new one.
  const runRef = useRef<Run | null>(null)
  // Set by `send` when it creates a conversation, so the navigation to its
  // URL keeps the run going and doesn't reload over the streaming answer.
  const createdIdRef = useRef<string | null>(null)
  // Async loads and version switches check these before updating the screen.
  const loadGeneration = useRef(0)
  const versionRequest = useRef(0)
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId

  const showItems = ({ items, usage }: ConversationWithItems) => {
    setTurns(toTurns(items))
    setUsage(usage)
  }

  useEffect(() => {
    if (conversationId && conversationId === createdIdRef.current) {
      createdIdRef.current = null
      return
    }
    loadGeneration.current += 1
    // Leaving a chat mid-answer counts as Stop: the server keeps the partial
    // answer. After the answer, the run just stops updating the screen.
    const run = runRef.current
    if (run && !run.answered) run.controller.abort()
    runRef.current = null
    setTurns([])
    setUsage(null)
    setPending(null)
    setError(null)
    setTemporaryId(null)
    setProjectId(null)
    if (!conversationId) return
    let current = true
    getConversation(conversationId).then(
      (loaded) => {
        if (!current) return
        showItems(loaded)
        const { conversation } = loaded
        setTemporaryId(conversation.temporary ? conversationId : null)
        setProjectId(conversation.projectId)
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

  /**
   * Sends `request`, showing `question` after the first `keep` turns. When
   * continuing an answer (after approval), `answer` is what it has so far.
   */
  async function run(
    request: TurnRequest,
    {
      answer: before,
      ...display
    }: { keep: number; question: Question; answer?: Answer | null },
  ) {
    const run: Run = { controller: new AbortController(), answered: false }
    runRef.current = run
    const live = () => runRef.current === run
    const showHistory = async (id: string) => {
      const loaded = await getConversation(id)
      if (live()) showItems(loaded)
    }

    let answer = before?.text ?? ''
    let thinking = before?.thinking ?? ''
    let tools = before?.tools ?? []
    let summaryIndex = 0
    let newThoughts = false
    /** The turn as streamed so far. */
    const turnSoFar = (key: string): Turn => ({
      key,
      question: display.question,
      compacted: false,
      answer:
        answer || thinking || tools.length > 0
          ? {
              itemId: null,
              text: answer,
              thinking,
              tools,
              usage: null,
              model: null,
              versions: null,
            }
          : null,
    })
    const show = () =>
      setPending({ keep: display.keep, turn: turnSoFar('pending') })
    const updateTool = (callId: string, change: Partial<ToolActivity>) => {
      tools = tools.map((t) => (t.callId === callId ? { ...t, ...change } : t))
      show()
    }
    /** The answer is complete and saved (or waits for approval). */
    const finish = async (id: string) => {
      // Saved: from now on Stop or leaving mustn't abort the stream, which
      // may still carry the title.
      run.answered = true
      try {
        await showHistory(id)
        if (live()) setPending(null)
      } catch (err) {
        if (!live()) return
        // The answer is saved even if fetching the updated history failed.
        // Keep what streamed; otherwise it would vanish with the pending turn.
        setError((err as Error).message)
        setTurns((prev) => [
          ...prev.slice(0, display.keep),
          turnSoFar(crypto.randomUUID()),
        ])
        setPending(null)
      }
    }

    setError(null)
    show()
    let id = conversationId
    // Whether the question reached the server (so the composer may drop the
    // draft). Before that, a failed send should leave the draft in place.
    let accepted = false
    try {
      if (!id) {
        const created = await createConversation({
          temporary,
          projectId: newProjectId,
        })
        id = created.id
        if (!created.temporary) onListChanged()
        if (!live()) return true
        createdIdRef.current = id
        setTemporaryId(created.temporary ? id : null)
        setProjectId(created.projectId)
        onCreated(id)
      }
      for await (const event of streamTurn(
        id,
        request,
        run.controller.signal,
      )) {
        accepted = true
        // The sidebar shows every chat, so a title is news even after the
        // user has moved on. Everything else only matters while on screen.
        if (event.type === 'chibot.title') onListChanged()
        if (!live()) continue
        if (event.type === 'response.output_text.delta') {
          answer += event.delta
          show()
        } else if (event.type === 'response.reasoning_summary_text.delta') {
          // Summaries can come in parts, and a turn with tool calls can
          // think more than once; each new part starts a new paragraph.
          if (thinking && (newThoughts || event.summary_index !== summaryIndex))
            thinking += '\n\n'
          newThoughts = false
          summaryIndex = event.summary_index
          thinking += event.delta
          show()
        } else if (event.type === 'response.output_item.added') {
          const { item } = event
          if (item.type === 'reasoning') newThoughts = true
          // Messages after tool calls are paragraphs of the same answer.
          if (item.type === 'message' && answer) answer += '\n\n'
          if (item.type === 'function_call') {
            tools = [
              ...tools,
              {
                callId: item.call_id,
                name: item.name,
                arguments: item.arguments,
                output: null,
              },
            ]
            show()
          }
        } else if (
          event.type === 'response.output_item.done' &&
          event.item.type === 'function_call'
        ) {
          updateTool(event.item.call_id, { arguments: event.item.arguments })
        } else if (event.type === 'chibot.tool_output') {
          updateTool(event.call_id, { output: event.output })
        } else if (
          event.type === 'response.completed' ||
          event.type === 'response.incomplete'
        ) {
          // Saved by now. Tool calls mean another response follows; otherwise
          // the stream may stay open a little longer for the title, but the
          // chat is free again.
          if (!event.response.output.some((i) => i.type === 'function_call'))
            await finish(id)
        } else if (event.type === 'chibot.approval') {
          await finish(id)
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
      accepted = true
      if (live() && !run.answered) await finish(id)
    } catch (err) {
      if (!live() || run.answered) return true
      if (run.controller.signal.aborted) {
        // The server keeps the partial answer. Show it without reloading,
        // because the save may not have landed yet. Without item ids its
        // actions stay hidden until the next reload.
        setTurns((prev) => [
          ...prev.slice(0, display.keep),
          turnSoFar(crypto.randomUUID()),
        ])
        accepted = true
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
    return accepted
  }

  const newQuestion = (
    text: string,
    parentId: number | null,
    attachments: Attachment[],
  ): Question => ({ itemId: null, parentId, text, attachments, versions: null })

  const fileIds = (attachments: Attachment[]) =>
    attachments.length > 0 ? { fileIds: attachments.map((a) => a.fileId) } : {}

  /**
   * Sends a new message after the last turn, with its `attachments`
   * (uploaded), optionally forcing `tool`.
   */
  function send(text: string, tool?: string, attachments: Attachment[] = []) {
    return run(
      { text, ...(tool && { tool }), ...fileIds(attachments) },
      { keep: turns.length, question: newQuestion(text, null, attachments) },
    )
  }

  /**
   * Replaces the question of turn `index` with `text` as a new version,
   * keeping its attachments.
   */
  function edit(index: number, text: string) {
    const { parentId, attachments } = turns[index]!.question
    return run(
      { text, parentId, ...fileIds(attachments) },
      { keep: index, question: newQuestion(text, parentId, attachments) },
    )
  }

  /** Answers the question of turn `index` again, as a new version. */
  function regenerate(index: number) {
    const { question } = turns[index]!
    return run({ parentId: question.itemId! }, { keep: index, question })
  }

  /** Approves or denies the tool calls waiting for approval, and continues. */
  function approve(approved: boolean) {
    const turn = turns.at(-1)!
    const approvals = Object.fromEntries(
      waitingCalls(turns).map((t) => [t.callId, approved]),
    )
    return run(
      { approvals },
      { keep: turns.length - 1, question: turn.question, answer: turn.answer },
    )
  }

  async function switchVersion(itemId: number) {
    if (!conversationId) return
    const id = conversationId
    const request = ++versionRequest.current
    const generation = loadGeneration.current
    const current = () =>
      request === versionRequest.current &&
      generation === loadGeneration.current &&
      conversationIdRef.current === id
    try {
      await putVersion(id, itemId)
      const loaded = await getConversation(id)
      if (current()) showItems(loaded)
    } catch (err) {
      if (current()) setError((err as Error).message)
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
    isTemporary: temporaryId !== null && temporaryId === conversationId,
    /** The project of the conversation on screen, if any. */
    projectId,
    busy: pending !== null,
    send,
    edit,
    regenerate,
    approve,
    switchVersion,
    stop,
  }
}
