import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import OpenAI from 'openai'
import { documentKind, fileKind } from '../shared/documents.ts'
import {
  conversationExportSchema,
  replaceFileIds,
  type ConversationExport,
} from '../shared/export.ts'
import { MAX_MEMORY_LENGTH } from '../shared/memory.ts'
import { messageText } from '../shared/messages.ts'
import {
  conversationPatchSchema,
  createConversationSchema,
  addProjectFileSchema,
  createProjectSchema,
  memoryPatchSchema,
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
  Health,
  McpServerStatus,
  ModelsResponse,
  ProjectWithContents,
  ToolInfo,
  TurnErrorEvent,
} from '../shared/types.ts'
import type { Attachments } from './attachments.ts'
import type { ChatService } from './chat-service.ts'
import type { Config } from './config.ts'
import type { ConversationStore } from './conversation-store.ts'
import type { FileStore } from './file-store.ts'
import type { McpServers } from './mcp-servers.ts'
import { normalizeMemory, type MemoryStore } from './memory-store.ts'
import type { ProjectIndex } from './project-index.ts'
import type { ProjectStore } from './project-store.ts'
import { toMarkdown } from './markdown-export.ts'
import type { SettingsStore } from './settings-store.ts'
import type { Transcription } from './transcription.ts'

export interface AppDeps {
  config: Config
  store: ConversationStore
  settings: SettingsStore
  chat: ChatService
  files: FileStore
  memories: MemoryStore
  projects: ProjectStore
  index: ProjectIndex
  attachments: Attachments
  mcp: McpServers
  /** Voice input, or `null` without a transcription endpoint. */
  transcription: Transcription | null
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
  attachments,
  mcp,
  transcription,
}: AppDeps) {
  const app = new Hono()

  // chibot has no login, so only this machine's names may reach it: a site
  // whose name is pointed at 127.0.0.1 (DNS rebinding) would otherwise be
  // same-origin with it.
  const allowedHost = (url: string) => {
    const host = URL.parse(url)?.hostname.replace(/^\[|\]$/g, '')
    return (
      !!host &&
      (isIP(host) !== 0 ||
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host === config.host)
    )
  }
  app.use(async (c, next) => {
    if (!allowedHost(c.req.url)) {
      return c.text('chibot only answers to this machine’s addresses', 403)
    }
    await next()
  })
  if (config.token) {
    const tokenCheck = requireToken(config.token)
    // The OAuth provider's redirect may come back on another of this
    // machine's names, without the cookie; its `state` is checked instead.
    app.use((c, next) =>
      c.req.path === OAUTH_CALLBACK ? next() : tokenCheck(c, next),
    )
  }
  // Form posts (uploads) skip CORS preflight, so other sites could send them.
  // Browsers mark every post with Origin or Sec-Fetch-Site; requests with
  // neither come from tools like curl, which no site can drive.
  const fromOtherSites = csrf({ origin: allowedHost })
  app.use((c, next) =>
    c.req.header('origin') || c.req.header('sec-fetch-site')
      ? fromOtherSites(c, next)
      : next(),
  )

  app.get('/api/health', (c) =>
    c.json({
      status: 'ok',
      model: config.chat.model,
      // Never expose the key.
      baseURL: config.chat.baseURL ?? null,
      features: { transcription: transcription !== null },
    } satisfies Health),
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

  app.patch('/api/settings', json(settingsPatchSchema), async (c) => {
    const updated = settings.update(c.req.valid('json'))
    // Switched MCP servers connect or stop.
    await mcp.sync()
    return c.json(updated)
  })

  const mcpStatus = (c: Context) =>
    c.json({ servers: mcp.statuses() } satisfies {
      servers: McpServerStatus[]
    })
  app.get('/api/mcp', mcpStatus)
  app.use(
    '/api/mcp/:name/:action{reconnect|sign-in|sign-out}',
    async (c, next) => {
      if (!mcp.has(c.req.param('name'))) return notFound(c, 'MCP server')
      await next()
    },
  )
  // mcp.json may have been edited since chibot started.
  app.post('/api/mcp/reload', async (c) => {
    try {
      await mcp.reload()
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
    return mcpStatus(c)
  })
  app.post('/api/mcp/:name/reconnect', async (c) => {
    await mcp.connect(c.req.param('name'))
    return mcpStatus(c)
  })
  app.post('/api/mcp/:name/sign-in', async (c) => {
    try {
      // Back to the address the user is on, with Settings → Tools open.
      const returnTo = new URL('/?settings=tools', c.req.url).href
      const url = await mcp.signIn(c.req.param('name'), returnTo)
      return c.json({ url: url?.href ?? null })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
  })
  app.post('/api/mcp/:name/sign-out', async (c) => {
    try {
      await mcp.signOut(c.req.param('name'))
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
    return mcpStatus(c)
  })
  app.get(OAUTH_CALLBACK, async (c) => {
    try {
      return c.redirect(await mcp.finishSignIn(new URL(c.req.url).searchParams))
    } catch (err) {
      return c.text((err as Error).message, 400)
    }
  })

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
    form(
      z.object({
        file: z.instanceof(File, { error: 'send the file as `file`' }),
      }),
    ),
    async (c) => {
      const { file } = c.req.valid('form')
      const kind = fileKind(file.name)
      if (!kind) {
        return c.json(
          { error: `${file.name}: only images, PDF, Word and text files` },
          415,
        )
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      return c.json(files.save(null, file.name, kind.mime, bytes), 201)
    },
  )

  app.post(
    '/api/transcriptions',
    bodyLimit({
      maxSize: AUDIO_LIMIT,
      onError: (c) =>
        c.json({ error: 'The recording is larger than 25 MB' }, 413),
    }),
    form(
      z.object({
        file: z.instanceof(File, { error: 'send the recording as `file`' }),
      }),
    ),
    async (c) => {
      if (!transcription) {
        return c.json({ error: 'No transcription endpoint is set up' }, 501)
      }
      const { file } = c.req.valid('form')
      try {
        const text = await transcription.transcribe(file, c.req.raw.signal)
        return c.json({ text })
      } catch (err) {
        return c.json({ error: (err as Error).message }, 502)
      }
    },
  )

  // Adds an uploaded file to a project and indexes it in the background.
  app.post('/api/projects/:id/files', json(addProjectFileSchema), (c) => {
    const project = projects.get(c.req.param('id'))
    const file = files.get(c.req.valid('json').fileId)
    if (!project) return notFound(c, 'Project')
    if (!file) return notFound(c, 'File')
    // Projects search text; images have none.
    if (!documentKind(file.name)) {
      return c.json({ error: `${file.name}: projects take documents` }, 415)
    }
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
    attachments.deleteOrphans()
    return c.body(null, 204)
  })

  app.get('/api/memories', (c) => c.json(memories.list().reverse()))

  app.patch('/api/memories/:id', json(memoryPatchSchema), (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || !memories.get(id)) {
      return notFound(c, 'Memory')
    }
    const text = normalizeMemory(c.req.valid('json').text)
    if (!text) return c.json({ error: 'A memory needs its text' }, 400)
    if (text.length > MAX_MEMORY_LENGTH) {
      return c.json(
        { error: `A memory can be at most ${MAX_MEMORY_LENGTH} characters` },
        400,
      )
    }
    const duplicate = memories.find(text)
    if (duplicate && duplicate.id !== id) {
      return c.json(
        { error: `That is already remembered: "${duplicate.text}"` },
        409,
      )
    }
    return c.json(memories.update(id, text)!)
  })

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

  app.all('/api/*', (c) => notFound(c, 'Route'))

  return app
}

// Exports embed their files (base64).
const IMPORT_LIMIT = 200 * 1024 * 1024
const FILE_LIMIT = 50 * 1024 * 1024
const AUDIO_LIMIT = 25 * 1024 * 1024

/** Answers a failed validation with a `{ error }` 400. */
const invalid = (
  result: { success: true } | { success: false; error: z.core.$ZodError },
  c: Context,
) => {
  if (!result.success) {
    return c.json({ error: z.prettifyError(result.error) }, 400)
  }
}

/** Validates a JSON body against `schema`. */
const json = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, invalid)

/** Validates a multipart form body against `schema`. */
const form = <T extends z.ZodType>(schema: T) =>
  zValidator('form', schema, invalid)

const TOKEN_COOKIE = 'chibot_token'
/** Where OAuth providers send the browser back after an MCP sign-in. */
export const OAUTH_CALLBACK = '/api/mcp/oauth/callback'

/**
 * Lets in browsers that opened chibot once with `?token=<CHIBOT_TOKEN>`
 * (remembered in a cookie); everything else gets a 401.
 */
function requireToken(token: string): MiddlewareHandler {
  const expected = Buffer.from(token)
  const matches = (value: string | undefined) => {
    const given = Buffer.from(value ?? '')
    return given.length === expected.length && timingSafeEqual(given, expected)
  }
  return async (c, next) => {
    if (matches(c.req.query('token'))) {
      setCookie(c, TOKEN_COOKIE, token, {
        httpOnly: true,
        // Never sent with requests from other sites.
        sameSite: 'Strict',
        path: '/',
        maxAge: 400 * 24 * 60 * 60, // browsers' upper limit
      })
      // Out of the address bar and history.
      const url = new URL(c.req.url)
      url.searchParams.delete('token')
      return c.redirect(url.pathname + url.search)
    }
    if (!matches(getCookie(c, TOKEN_COOKIE))) {
      const error =
        'chibot needs its access token: open it once as …/?token=<CHIBOT_TOKEN>'
      return c.req.path.startsWith('/api/')
        ? c.json({ error }, 401)
        : c.text(error, 401)
    }
    await next()
  }
}

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
