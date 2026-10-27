import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { Hono, type MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import type { Health } from '../shared/types.ts'
import type { Attachments } from './attachments.ts'
import type { ChatService } from './chat-service.ts'
import type { Config } from './config.ts'
import type { ConversationStore } from './conversation-store.ts'
import type { FileStore } from './file-store.ts'
import type { McpServers } from './mcp-servers.ts'
import { type MemoryStore } from './memory-store.ts'
import type { ProjectIndex } from './project-index.ts'
import type { ProjectStore } from './project-store.ts'
import type { SettingsStore } from './settings-store.ts'
import type { Transcription } from './transcription.ts'
import { OAUTH_CALLBACK, mcpRoutes } from './routes/mcp.ts'
import { conversationRoutes } from './routes/conversations.ts'
import { fileRoutes } from './routes/files.ts'
import { memoryRoutes } from './routes/memories.ts'
import { projectRoutes } from './routes/projects.ts'
import { settingsRoutes } from './routes/settings.ts'
import { notFound } from './routes/helpers.ts'

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
export function createApp(deps: AppDeps) {
  const { config, transcription } = deps
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

  app.route('/', settingsRoutes(deps))
  app.route('/', mcpRoutes(deps))
  app.route('/', conversationRoutes(deps))
  app.route('/', projectRoutes(deps))
  app.route('/', memoryRoutes(deps))
  app.route('/', fileRoutes(deps))

  app.all('/api/*', (c) => notFound(c, 'Route'))

  return app
}

const TOKEN_COOKIE = 'chibot_token'
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
