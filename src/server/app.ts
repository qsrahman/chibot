import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import OpenAI from 'openai'
import { documentKind } from '../shared/documents.ts'
import { conversationExportSchema } from '../shared/export.ts'
import { messageText } from '../shared/messages.ts'
import {
  conversationPatchSchema,
  createConversationSchema,
  addProjectFileSchema,
  createProjectSchema,
  projectPatchSchema,
  switchVersionSchema,
  turnRequestSchema,
} from '../shared/requests.ts'
import {
  settingsPatchSchema,
  type SettingsResponse,
} from '../shared/settings.ts'
import type {
  ConversationWithItems,
  ModelsResponse,
  ProjectWithContents,
  ToolInfo,
  TurnErrorEvent,
} from '../shared/types.ts'
import type { ChatService } from './chat-service.ts'
import type { Config } from './config.ts'
import type { ConversationStore } from './conversation-store.ts'
import type { FileStore } from './file-store.ts'
import type { MemoryStore } from './memory-store.ts'
import type { ProjectIndex } from './project-index.ts'
import type { ProjectStore } from './project-store.ts'
import { toMarkdown } from './markdown-export.ts'
import type { SettingsStore } from './settings-store.ts'

export interface AppDeps {
  config: Config
  store: ConversationStore
  settings: SettingsStore
  chat: ChatService
  files: FileStore
  memories: MemoryStore
  projects: ProjectStore
  index: ProjectIndex
}

/** Builds the HTTP app. A factory so tests can inject fakes. */
export function createApp({
  config,
  store,
  settings,
  chat,
  files,
  memories,
  projects,
  index,
}: AppDeps) {
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

  // Whether each is on is the `disabledTools` setting.
  app.get('/api/tools', (c) =>
    c.json({ tools: chat.tools } satisfies { tools: ToolInfo[] }),
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

  app.delete('/api/conversations/:id', (c) => {
    if (!store.deleteConversation(c.req.param('id'))) {
      return notFound(c)
    }
    files.deleteOrphans()
    return c.body(null, 204)
  })

  app.get('/api/projects', (c) => c.json(projects.list()))

  app.post('/api/projects', json(createProjectSchema), (c) =>
    c.json(projects.create(c.req.valid('json').name), 201),
  )

  app.get('/api/projects/:id', (c) => {
    const project = projects.get(c.req.param('id'))
    if (!project) return notFound(c, 'Project')
    const contents: ProjectWithContents = {
      project,
      files: projects.files(project.id),
      conversations: store.listConversations({ projectId: project.id }),
    }
    return c.json(contents)
  })

  app.post(
    '/api/files',
    bodyLimit({
      maxSize: FILE_LIMIT,
      onError: (c) => c.json({ error: 'The file is larger than 50 MB' }, 413),
    }),
    async (c) => {
      const { file } = await c.req.parseBody()
      if (!(file instanceof File)) {
        return c.json({ error: 'Send the file as `file` (multipart)' }, 400)
      }
      const kind = documentKind(file.name)
      if (!kind) {
        return c.json(
          { error: `${file.name}: only PDF, Word and text files` },
          415,
        )
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      return c.json(files.save(null, file.name, kind.mime, bytes), 201)
    },
  )

  // Adds an uploaded file to a project and indexes it in the background.
  app.post('/api/projects/:id/files', json(addProjectFileSchema), (c) => {
    const project = projects.get(c.req.param('id'))
    const file = files.get(c.req.valid('json').fileId)
    if (!project) return notFound(c, 'Project')
    if (!file) return notFound(c, 'File')
    if (file.conversationId !== null || projects.hasFile(file.id)) {
      return c.json({ error: 'The file is already in use' }, 409)
    }
    projects.addFile(project.id, file.id)
    void index.index(file.id)
    return c.json(projects.files(project.id), 201)
  })

  app.delete('/api/projects/:id/files/:fileId', (c) => {
    const removed = projects.removeFile(
      c.req.param('id'),
      c.req.param('fileId'),
    )
    return removed ? c.body(null, 204) : notFound(c, 'File')
  })

  app.patch('/api/projects/:id', json(projectPatchSchema), (c) => {
    const project = projects.update(c.req.param('id'), c.req.valid('json'))
    return project ? c.json(project) : notFound(c, 'Project')
  })

  // Deletes the project's chats and files with it.
  app.delete('/api/projects/:id', (c) => {
    const id = c.req.param('id')
    if (!projects.get(id)) return notFound(c, 'Project')
    store
      .projectConversationIds(id)
      .forEach((chat) => store.deleteConversation(chat))
    projects.delete(id)
    files.deleteOrphans()
    return c.body(null, 204)
  })

  app.get('/api/memories', (c) => c.json(memories.list().reverse()))

  app.delete('/api/memories/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || !memories.delete(id)) {
      return notFound(c, 'Memory')
    }
    return c.body(null, 204)
  })

  app.delete('/api/memories', (c) => {
    memories.clear()
    return c.body(null, 204)
  })

  app.get('/api/files/:id', (c) => {
    const file = files.get(c.req.param('id'))
    if (!file) return notFound(c, 'File')
    return c.body(files.read(file.id), 200, {
      'Content-Type': file.mime,
      'X-Content-Type-Options': 'nosniff',
      // Uploads are served from chibot's origin: an HTML file opened here must
      // not run scripts that could use the API. (PDFs are left alone: the
      // browser's viewer doesn't render them in a sandbox.)
      ...(file.mime !== 'application/pdf' && {
        'Content-Security-Policy': 'sandbox',
      }),
      // A file never changes under its id.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': disposition('inline', file.name),
    })
  })

  app.get('/api/conversations/:id/export', (c) => {
    const id = c.req.param('id')
    const exported = store.exportConversation(id)
    if (!exported) return notFound(c)
    const markdown = c.req.query('format') === 'md'
    const name = `${exported.conversation.title ?? 'chat'}.${markdown ? 'md' : 'json'}`
    const body = markdown
      ? toMarkdown(store.getConversation(id)!, store.getPath(id))
      : JSON.stringify(exported, null, 2)
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
      onError: (c) => c.json({ error: 'The file is larger than 20 MB' }, 413),
    }),
    json(conversationExportSchema),
    (c) => c.json(store.importConversation(c.req.valid('json')), 201),
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
    if (request.approvals && chat.waitingCalls(id).length === 0) {
      return c.json({ error: 'No tool calls are waiting for approval' }, 409)
    }
    if (typeof request.parentId === 'number') {
      const parent = store.getItem(id, request.parentId)
      if (!parent) return notFound(c, 'Item')
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
      return notFound(c, 'Item')
    }
    return c.body(null, 204)
  })

  app.all('/api/*', (c) => notFound(c, 'Route'))

  return app
}

const IMPORT_LIMIT = 20 * 1024 * 1024
const FILE_LIMIT = 50 * 1024 * 1024

/** Validates a JSON body against `schema`; failures are `{ error }` 400s. */
const json = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: z.prettifyError(result.error) }, 400)
    }
  })

/** RFC 6266: `filename*` carries non-ASCII names. */
const disposition = (type: 'inline' | 'attachment', name: string) =>
  `${type}; filename*=UTF-8''${encodeURIComponent(name)}`

const notFound = (c: Context, what = 'Conversation') =>
  c.json({ error: `${what} not found` }, 404)

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
