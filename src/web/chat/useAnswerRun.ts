import { useRef, useState } from 'react'
import type { TurnRequest } from '../../shared/types.ts'
import { errorMessage } from '../../shared/errors.ts'
import { createConversation } from '../conversations/api.ts'
import { streamTurn } from './api.ts'
import { applyEvent, startAnswer, turnSoFar } from './streamedAnswer.ts'
import {
  fileIds,
  newQuestion,
  waitingCalls,
  type Answer,
  type Attachment,
  type Question,
  type Turn,
} from './turns.ts'
import type { Compacting } from './useCompaction.ts'
import type { ChatHistory } from './useChatHistory.ts'
import { useQueue } from './useQueue.ts'

/** The turn being answered, shown after the first `keep` turns. */
export interface Pending {
  keep: number
  turn: Turn
}

export interface ChatOptions {
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

/**
 * Asking for answers: sending, editing, regenerating and approving, the turn
 * being streamed (`pending`), Stop, and the message queued while an answer
 * streams. What each request shows goes to the chat's history and, for
 * summaries made before an answer, to `compaction`.
 */
export function useAnswerRun(
  conversationId: string | undefined,
  { onCreated, onListChanged, temporary, projectId: newProjectId }: ChatOptions,
  history: ChatHistory,
  compaction: Compacting,
  setError: (message: string | null) => void,
) {
  const [pending, setPending] = useState<Pending | null>(null)
  // A message typed while an answer streams goes once that answer is saved.
  const queue = useQueue()
  // The run whose updates belong on screen. Cleared when the user switches
  // chats, so a run still going for the old chat can't touch the new one.
  const runRef = useRef<Run | null>(null)
  // Set by `send` when it creates a conversation, so the navigation to its
  // URL keeps the run going and doesn't reload over the streaming answer.
  const createdId = useRef<string | null>(null)

  /** Stop, or leaving the chat: a request still being answered is given up. */
  function stop() {
    const run = runRef.current
    if (run && !run.answered) run.controller.abort()
  }

  /**
   * The user opened another chat. Leaving mid-answer counts as Stop (the
   * server keeps the partial answer); after the answer, the run just stops
   * updating the screen.
   */
  function leave() {
    stop()
    runRef.current = null
    setPending(null)
    queue.clear()
  }

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
    /** The chat to run in, when called from a run that started a new one. */
    chatId = conversationId,
  ) {
    const run: Run = { controller: new AbortController(), answered: false }
    runRef.current = run
    const live = () => runRef.current === run
    /** Reloads the chat; the number of turns it now has, or `null` after a switch. */
    const showHistory = (id: string) => history.reload(id, live)

    let streamed = startAnswer(before)
    /** The turn as streamed so far. */
    const soFar = (key: string, incomplete = false) =>
      turnSoFar(display.question, streamed, key, incomplete)
    const show = () =>
      setPending({ keep: display.keep, turn: soFar('pending') })
    /** The answer is complete and saved (or waits for approval). */
    const finish = async (id: string, done = true) => {
      // Saved: from now on Stop or leaving mustn't abort the stream, which
      // may still carry the title.
      run.answered = true
      try {
        const kept = await showHistory(id)
        if (!live()) return
        setPending(null)
        if (done) drain(id, kept ?? display.keep + 1)
      } catch (err) {
        if (!live()) return
        // The answer is saved even if fetching the updated history failed.
        // Keep what streamed; otherwise it would vanish with the pending turn.
        setError(errorMessage(err))
        history.setTurns((prev) => [
          ...prev.slice(0, display.keep),
          soFar(crypto.randomUUID()),
        ])
        setPending(null)
        if (done) drain(id, display.keep + 1)
      }
    }

    setError(null)
    show()
    let id = chatId
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
        createdId.current = id
        history.adopt(created)
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
        if (event.type === 'chibot.title') {
          onListChanged()
          if (live()) history.setTitle(event.title)
        }
        if (!live()) continue
        if (event.type === 'chibot.compaction') {
          compaction.onEvent(event)
          continue
        }
        const applied = applyEvent(streamed, event)
        streamed = applied.streamed
        if (applied.changed) show()
        const { effect } = applied
        if (effect?.type === 'answered') await finish(id)
        else if (effect?.type === 'approval') await finish(id, false)
        else if (effect?.type === 'error') setError(effect.message)
      }
      accepted = true
      if (live() && !run.answered) await finish(id)
    } catch (err) {
      if (!live() || run.answered) return true
      if (run.controller.signal.aborted) {
        // The server keeps the partial answer. Show it without reloading,
        // because the save may not have landed yet. Without item ids its
        // actions stay hidden until the next reload.
        history.setTurns((prev) => [
          ...prev.slice(0, display.keep),
          soFar(crypto.randomUUID(), true),
        ])
        accepted = true
        // The saved partial becomes the new leaf, so a queued message can
        // follow it (the server saves it as the aborted request unwinds).
        if (id) drain(id, display.keep + 1)
      } else {
        setError(errorMessage(err))
        if (id) await showHistory(id).catch(() => {})
      }
    } finally {
      if (live()) {
        runRef.current = null
        setPending(null)
        compaction.setSummarizing(false)
      }
    }
    return accepted
  }

  /**
   * Sends a new message after the last turn, with its `attachments`
   * (uploaded), optionally forcing `tool`.
   */
  function send(text: string, tool?: string, attachments: Attachment[] = []) {
    return run(
      { text, ...(tool && { tool }), ...fileIds(attachments) },
      {
        keep: history.turns.length,
        question: newQuestion(text, null, attachments),
      },
    )
  }

  /**
   * Sends the message queued during the answer that just finished, if any.
   * `keep` is how many turns the chat has now.
   */
  function drain(chatId: string, keep: number) {
    const next = queue.take()
    if (!next) return
    void run(
      { text: next.text, ...(next.tool && { tool: next.tool }) },
      { keep, question: newQuestion(next.text, null, []) },
      chatId,
    ).then((accepted) => {
      // Refused before it reached the server: keep it for another try.
      if (!accepted) queue.put(next)
    })
  }

  /**
   * Replaces the question of turn `index` with `text` as a new version,
   * keeping its attachments.
   */
  function edit(index: number, text: string) {
    const { parentId, attachments } = history.turns[index]!.question
    return run(
      { text, parentId, ...fileIds(attachments) },
      { keep: index, question: newQuestion(text, parentId, attachments) },
    )
  }

  /** Answers the question of turn `index` again, as a new version. */
  function regenerate(index: number) {
    const { question } = history.turns[index]!
    return run({ parentId: question.itemId! }, { keep: index, question })
  }

  /** Approves or denies the tool calls waiting for approval, and continues. */
  function approve(approved: boolean) {
    const { turns } = history
    const turn = turns.at(-1)!
    const approvals = Object.fromEntries(
      waitingCalls(turns).map((t) => [t.callId, approved]),
    )
    return run(
      { approvals },
      { keep: turns.length - 1, question: turn.question, answer: turn.answer },
    )
  }

  return {
    pending,
    /** The message waiting for the current answer, if any. */
    queued: queue.queued?.text ?? null,
    createdId,
    send,
    edit,
    regenerate,
    approve,
    stop,
    leave,
    /** Holds `text` until the current answer is saved, then sends it. */
    enqueue: (text: string, tool?: string) =>
      queue.put({ text, ...(tool && { tool }) }),
    /** Takes the queued message out (to edit it); `null` if there is none. */
    takeQueued: (): string | null => queue.take()?.text ?? null,
    cancelQueued: () => queue.clear(),
  }
}
