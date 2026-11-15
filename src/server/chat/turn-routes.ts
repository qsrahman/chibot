import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import OpenAI from 'openai'
import {
  compactRequestSchema,
  turnRequestSchema,
} from '../../shared/requests.ts'
import type { TurnErrorEvent } from '../../shared/types.ts'
import { refuseTurn } from './turn-request.ts'
import type { ChatService } from './chat-service.ts'
import { cleanFocus, type Compactor } from './compactor.ts'
import type { ConversationStore } from '../conversations/index.ts'
import type { FileStore } from '../file-store.ts'
import type { ProjectStore } from '../projects/index.ts'
import { explainApiError } from '../api-errors.ts'
import { json, notFound } from '../routes/helpers.ts'

/** Asking for an answer (streamed), and summarizing a chat's start. */
export function conversationTurnRoutes({
  store,
  chat,
  compactor,
  files,
  projects,
}: {
  store: ConversationStore
  chat: ChatService
  compactor: Compactor
  files: FileStore
  projects: ProjectStore
}) {
  const app = new Hono()

  // Summarizes the start of the chat now, with an optional focus.
  app.post(
    '/api/conversations/:id/compact',
    json(compactRequestSchema),
    async (c) => {
      const id = c.req.param('id')
      const conversation = store.getConversation(id)
      if (!conversation) return notFound(c)
      const job =
        conversation.currentLeafId === null
          ? null
          : compactor.prepare(id, conversation.currentLeafId)
      if (!job) {
        return c.json({ error: 'There is nothing to summarize yet' }, 409)
      }
      try {
        const focus = cleanFocus(c.req.valid('json').focus)
        return c.json(
          await compactor.run(job, { focus, signal: c.req.raw.signal }),
          201,
        )
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err) },
          502,
        )
      }
    },
  )

  // Undo: the chat goes back to the messages the summary stood for.
  app.delete('/api/conversations/:id/compactions/:compactionId', (c) => {
    const removed = compactor.delete(
      c.req.param('id'),
      Number(c.req.param('compactionId')),
    )
    return removed ? c.body(null, 204) : notFound(c, 'Compaction')
  })

  app.post('/api/conversations/:id/turns', json(turnRequestSchema), (c) => {
    const id = c.req.param('id')
    if (!store.getConversation(id)) return notFound(c)
    const request = c.req.valid('json')
    const refusal = refuseTurn({ store, chat, files, projects }, id, request)
    if (refusal) return c.json({ error: refusal.error }, refusal.status)
    // Only once the turn is accepted: a refused one leaves its uploads unsent.
    files.link(request.fileIds ?? [], id)
    // Aborted when the client disconnects or presses Stop. Passing it on
    // cancels the upstream request too.
    const { signal } = c.req.raw
    return streamSSE(c, async (stream) => {
      try {
        for await (const event of chat.runTurn(id, request, signal)) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          })
        }
      } catch (err) {
        if (signal.aborted) return // nobody is listening any more
        await stream.writeSSE({
          event: 'chibot.error',
          data: JSON.stringify(toErrorEvent(err)),
        })
      }
    })
  })

  return app
}

function toErrorEvent(err: unknown): TurnErrorEvent {
  if (err instanceof OpenAI.APIError) {
    return {
      type: 'chibot.error',
      message: explainApiError(err),
      status: err.status,
      ...(err instanceof OpenAI.APIConnectionError &&
        !(err instanceof OpenAI.APIConnectionTimeoutError) && {
          unreachable: true,
        }),
      requestId: err.requestID ?? undefined,
    }
  }
  console.error(err)
  return {
    type: 'chibot.error',
    message: err instanceof Error ? err.message : String(err),
  }
}
