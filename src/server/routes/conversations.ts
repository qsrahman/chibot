import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import OpenAI from 'openai'
import { fileKind } from '../../shared/documents.ts'
import {
  conversationExportSchema,
  replaceFileIds,
  type ConversationExport,
} from '../../shared/export.ts'
import { messageText } from '../../shared/messages.ts'
import {
  conversationPatchSchema,
  createConversationSchema,
  switchVersionSchema,
  turnRequestSchema,
} from '../../shared/requests.ts'
import type {
  ConversationWithItems,
  TurnErrorEvent,
} from '../../shared/types.ts'
import { toMarkdown } from '../markdown-export.ts'
import type { AppDeps } from '../app.ts'
import { disposition, json, notFound } from './helpers.ts'

export function conversationRoutes({
  store,
  chat,
  files,
  projects,
  attachments,
}: AppDeps) {
  const app = new Hono()

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
    (c) => {
      const request = c.req.valid('json')
      if (request.projectId && !projects.get(request.projectId)) {
        return notFound(c, 'Project')
      }
      return c.json(store.createConversation(request), 201)
    },
  )

  app.patch('/api/conversations/:id', json(conversationPatchSchema), (c) => {
    const patch = c.req.valid('json')
    if (patch.projectId && !projects.get(patch.projectId)) {
      return notFound(c, 'Project')
    }
    const updated = store.updateConversation(c.req.param('id'), patch)
    if (!updated) return notFound(c)
    return c.json(updated)
  })

  app.post('/api/conversations/:id/title', async (c) => {
    const id = c.req.param('id')
    const conversation = store.getConversation(id)
    if (!conversation) return notFound(c)
    if (conversation.temporary) {
      return c.json({ error: 'Temporary chats have no title' }, 400)
    }
    if (!store.getPath(id).some((item) => messageText(item.data))) {
      return c.json({ error: 'There is nothing to title yet' }, 400)
    }
    const title = await chat.regenerateTitle(id, c.req.raw.signal)
    if (!title) {
      return c.json({ error: 'The model gave no title; try again' }, 502)
    }
    return c.json({ title })
  })

  app.delete('/api/conversations/:id', (c) => {
    if (!store.deleteConversation(c.req.param('id'))) {
      return notFound(c)
    }
    attachments.deleteOrphans()
    return c.body(null, 204)
  })

  app.get('/api/conversations/:id/export', (c) => {
    const id = c.req.param('id')
    const exported = store.exportConversation(id)
    if (!exported) return notFound(c)
    const markdown = c.req.query('format') === 'md'
    const name = `${exported.conversation.title ?? 'chat'}.${markdown ? 'md' : 'json'}`
    const chatFiles = files.ofConversation(id)
    const body = markdown
      ? toMarkdown(
          store.getConversation(id)!,
          store.getPath(id),
          new Map(chatFiles.map((file) => [file.id, file.name])),
        )
      : JSON.stringify(
          {
            ...exported,
            files: chatFiles.map(({ id, name }) => ({
              id,
              name,
              data: files.read(id).toString('base64'),
            })),
          } satisfies ConversationExport,
          null,
          2,
        )
    return c.body(body, 200, {
      'Content-Type': markdown
        ? 'text/markdown; charset=utf-8'
        : 'application/json; charset=utf-8',
      'Content-Disposition': disposition('attachment', name),
    })
  })

  app.post(
    '/api/conversations/import',
    bodyLimit({
      maxSize: IMPORT_LIMIT,
      onError: (c) => c.json({ error: 'The file is larger than 200 MB' }, 413),
    }),
    json(conversationExportSchema),
    (c) => {
      const { files: embedded, ...data } = c.req.valid('json')
      const savedIds = new Map<string, string>()
      const saved = embedded.map(({ id, name, data: base64 }) => {
        // The type follows the name, as for uploads: an export can't choose
        // how a file is served.
        const mime = fileKind(name)?.mime ?? 'application/octet-stream'
        const file = files.save(null, name, mime, Buffer.from(base64, 'base64'))
        savedIds.set(id, file.id)
        return file.id
      })
      const conversation = store.importConversation({
        ...data,
        items: replaceFileIds(data.items, savedIds),
      })
      files.link(saved, conversation.id)
      return c.json(conversation, 201)
    },
  )

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
    // Attachments: our uploads (or this chat's own files), not a project's.
    for (const fileId of request.fileIds ?? []) {
      const file = files.get(fileId)
      if (
        !file ||
        !fileKind(file.name) ||
        projects.hasFile(fileId) ||
        (file.conversationId !== null && file.conversationId !== id)
      ) {
        return c.json({ error: `File ${fileId} can't be attached here` }, 400)
      }
    }
    if (request.approvals && chat.waitingCalls(id).length === 0) {
      return c.json({ error: 'No tool calls are waiting for approval' }, 409)
    }
    if (typeof request.parentId === 'number') {
      const parent = store.getItem(id, request.parentId)
      if (!parent) return notFound(c, 'Item')
      const role = messageText(parent.data)?.role
      // A regenerate answers a user message. A new or edited message follows
      // a message (another user message, after a turn that failed or was
      // stopped early) or a tool output (a stopped or denied call), but not
      // an item in the middle of an answer, such as reasoning.
      if (request.text === undefined) {
        if (role !== 'user') {
          return c.json({ error: 'Only a user message can be answered' }, 400)
        }
      } else if (
        !role &&
        !('type' in parent.data && parent.data.type === 'function_call_output')
      ) {
        return c.json(
          { error: 'A message can only follow a message or a tool output' },
          400,
        )
      }
    }
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

  app.put('/api/conversations/:id/leaf', json(switchVersionSchema), (c) => {
    const id = c.req.param('id')
    if (!store.getConversation(id)) return notFound(c)
    if (!store.switchToVersion(id, c.req.valid('json').itemId)) {
      return notFound(c, 'Item')
    }
    return c.body(null, 204)
  })

  return app
}

// Exports embed their files (base64).
const IMPORT_LIMIT = 200 * 1024 * 1024

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
