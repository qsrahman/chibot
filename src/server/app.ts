import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { validator } from 'hono/validator'
import OpenAI from 'openai'
import type {
  ConversationPatch,
  ConversationWithItems,
  TurnErrorEvent,
} from '../shared/types.ts'
import type { ChatService } from './chat-service.ts'
import type { Config } from './config.ts'
import type { ConversationStore } from './conversation-store.ts'

export interface AppDeps {
  config: Config
  store: ConversationStore
  chat: ChatService
}

/** Builds the HTTP app. A factory so tests can inject fakes. */
export function createApp({ config, store, chat }: AppDeps) {
  const app = new Hono()

  app.get('/api/health', (c) =>
    c.json({
      status: 'ok',
      model: config.chat.model,
      // null = OpenAI. Never expose the key.
      baseURL: config.chat.baseURL ?? null,
    }),
  )

  app.get('/api/conversations', (c) => {
    const q = c.req.query('q')?.trim()
    if (q) return c.json(store.searchConversations(q))
    return c.json(
      store.listConversations({ archived: c.req.query('archived') === '1' }),
    )
  })

  app.post('/api/conversations', async (c) => {
    // The body is optional: `{ temporary: true }` starts a temporary chat.
    const body = (await c.req.json().catch(() => null)) as {
      temporary?: unknown
    } | null
    return c.json(
      store.createConversation({ temporary: body?.temporary === true }),
      201,
    )
  })

  app.patch(
    '/api/conversations/:id',
    validator('json', (body, c) => {
      const { title, pinned, archived } = (body ?? {}) as Record<
        string,
        unknown
      >
      const patch: ConversationPatch = {}
      if (title !== undefined) {
        if (typeof title !== 'string' || !title.trim()) {
          return c.json({ error: '`title` must be a non-empty string' }, 400)
        }
        patch.title = title.trim().slice(0, 200)
      }
      for (const [key, value] of [
        ['pinned', pinned],
        ['archived', archived],
      ] as const) {
        if (value === undefined) continue
        if (typeof value !== 'boolean') {
          return c.json({ error: `\`${key}\` must be a boolean` }, 400)
        }
        patch[key] = value
      }
      return patch
    }),
    (c) => {
      const updated = store.updateConversation(
        c.req.param('id'),
        c.req.valid('json'),
      )
      if (!updated) return c.json({ error: 'Conversation not found' }, 404)
      return c.json(updated)
    },
  )

  app.delete('/api/conversations/:id', (c) => {
    if (!store.deleteConversation(c.req.param('id'))) {
      return c.json({ error: 'Conversation not found' }, 404)
    }
    return c.body(null, 204)
  })

  app.get('/api/conversations/:id', (c) => {
    const id = c.req.param('id')
    const conversation = store.getConversation(id)
    if (!conversation) return c.json({ error: 'Conversation not found' }, 404)
    return c.json({
      conversation,
      items: store.getPath(id),
    } satisfies ConversationWithItems)
  })

  app.post(
    '/api/conversations/:id/turns',
    validator('json', (body, c) => {
      const text = (body as { text?: unknown } | null)?.text
      if (typeof text !== 'string' || !text.trim()) {
        return c.json({ error: '`text` must be a non-empty string' }, 400)
      }
      return { text }
    }),
    (c) => {
      const id = c.req.param('id')
      if (!store.getConversation(id)) {
        return c.json({ error: 'Conversation not found' }, 404)
      }
      const { text } = c.req.valid('json')
      // Aborted when the client disconnects or presses Stop. Passing it on
      // cancels the upstream request too.
      const { signal } = c.req.raw
      return streamSSE(c, async (stream) => {
        try {
          for await (const event of chat.sendMessage(id, text, signal)) {
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
    },
  )

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  return app
}

function toErrorEvent(err: unknown): TurnErrorEvent {
  if (err instanceof OpenAI.APIError) {
    return {
      type: 'chibot.error',
      message: err.message,
      status: err.status,
      requestId: err.requestID ?? undefined,
    }
  }
  console.error(err)
  return {
    type: 'chibot.error',
    message: err instanceof Error ? err.message : String(err),
  }
}
