import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import OpenAI from 'openai'
import { messageText } from '../shared/messages.ts'
import {
  conversationPatchSchema,
  createConversationSchema,
  switchVersionSchema,
  turnRequestSchema,
} from '../shared/requests.ts'
import {
  settingsPatchSchema,
  type SettingsResponse,
} from '../shared/settings.ts'
import type { ModelsResponse } from '../shared/types.ts'
import type { ConversationWithItems, TurnErrorEvent } from '../shared/types.ts'
import type { ChatService } from './chat-service.ts'
import type { Config } from './config.ts'
import type { ConversationStore } from './conversation-store.ts'
import type { SettingsStore } from './settings-store.ts'

export interface AppDeps {
  config: Config
  store: ConversationStore
  settings: SettingsStore
  chat: ChatService
}

/** Builds the HTTP app. A factory so tests can inject fakes. */
export function createApp({ config, store, settings, chat }: AppDeps) {
  const app = new Hono()

  app.get('/api/health', (c) =>
    c.json({
      status: 'ok',
      model: config.chat.model,
      // null = OpenAI. Never expose the key.
      baseURL: config.chat.baseURL ?? null,
    }),
  )

  app.get('/api/settings', (c) =>
    c.json({
      settings: settings.get(),
      defaults: settings.defaults,
    } satisfies SettingsResponse),
  )

  app.patch('/api/settings', json(settingsPatchSchema), (c) =>
    c.json(settings.update(c.req.valid('json'))),
  )

  app.get('/api/models', async (c) =>
    c.json({ models: await chat.listModels() } satisfies ModelsResponse),
  )

  app.get('/api/conversations', (c) => {
    const q = c.req.query('q')?.trim()
    if (q) return c.json(store.searchConversations(q))
    return c.json(
      store.listConversations({ archived: c.req.query('archived') === '1' }),
    )
  })

  app.post(
    '/api/conversations',
    // The body is optional: `{ temporary: true }` starts a temporary chat.
    json(createConversationSchema),
    (c) => c.json(store.createConversation(c.req.valid('json')), 201),
  )

  app.patch('/api/conversations/:id', json(conversationPatchSchema), (c) => {
    const updated = store.updateConversation(
      c.req.param('id'),
      c.req.valid('json'),
    )
    if (!updated) return notFound(c)
    return c.json(updated)
  })

  app.delete('/api/conversations/:id', (c) => {
    if (!store.deleteConversation(c.req.param('id'))) {
      return notFound(c)
    }
    return c.body(null, 204)
  })

  app.get('/api/conversations/:id', (c) => {
    const id = c.req.param('id')
    const conversation = store.getConversation(id)
    if (!conversation) return notFound(c)
    return c.json({
      conversation,
      items: store.getPath(id),
      usage: store.getUsageTotals(id),
    } satisfies ConversationWithItems)
  })

  app.post('/api/conversations/:id/turns', json(turnRequestSchema), (c) => {
    const id = c.req.param('id')
    if (!store.getConversation(id)) return notFound(c)
    const request = c.req.valid('json')
    if (typeof request.parentId === 'number') {
      const parent = store.getItem(id, request.parentId)
      if (!parent) return c.json({ error: 'Item not found' }, 404)
      // A regenerate answers a user message; anything else has no question.
      if (
        request.text === undefined &&
        messageText(parent.data)?.role !== 'user'
      ) {
        return c.json({ error: 'Only a user message can be answered' }, 400)
      }
    }
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

  app.put('/api/conversations/:id/leaf', json(switchVersionSchema), (c) => {
    const id = c.req.param('id')
    if (!store.getConversation(id)) return notFound(c)
    if (!store.switchToVersion(id, c.req.valid('json').itemId)) {
      return c.json({ error: 'Item not found' }, 404)
    }
    return c.body(null, 204)
  })

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  return app
}

/** Validates a JSON body against `schema`; failures are `{ error }` 400s. */
const json = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: z.prettifyError(result.error) }, 400)
    }
  })

const notFound = (c: Context) =>
  c.json({ error: 'Conversation not found' }, 404)

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
