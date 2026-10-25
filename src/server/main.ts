#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import OpenAI from 'openai'
import { createApp } from './app.ts'
import { Attachments } from './attachments.ts'
import { ChatService } from './chat-service.ts'
import { Config, loadEnvFiles } from './config.ts'
import { ConversationStore } from './conversation-store.ts'
import { openDatabase } from './database.ts'
import { FileStore } from './file-store.ts'
import { McpAuthStore } from './mcp-auth.ts'
import { loadMcpConfig, type McpServerConfig } from './mcp-config.ts'
import { McpServers } from './mcp-servers.ts'
import { MemoryStore } from './memory-store.ts'
import { ProjectIndex } from './project-index.ts'
import { ProjectStore } from './project-store.ts'
import { settingsDefaults, SettingsStore } from './settings-store.ts'
import type { Tool } from './tool.ts'
import { ToolRegistry } from './tool-registry.ts'
import { Transcription } from './transcription.ts'
import { CalculatorTool } from './tools/calculator.ts'
import { FetchUrlTool } from './tools/fetch-url.ts'
import { EditImageTool, GenerateImageTool } from './tools/images.ts'
import { mcpTools } from './tools/mcp-tool.ts'
import { MemoryTool } from './tools/memory.ts'
import { SearchProjectFilesTool } from './tools/project-files.ts'
import { SearchChatsTool } from './tools/search-chats.ts'
import { WebSearchTool } from './tools/web-search.ts'

/** What tools may need to be built. */
export interface ToolDeps {
  config: Config
  store: ConversationStore
  files: FileStore
  memories: MemoryStore
  projects: ProjectStore
  index: ProjectIndex
}

/** The shipped tools whose setup exists (e.g. a Brave key for web search). */
export function defaultTools({
  config,
  store,
  files,
  memories,
  projects,
  index,
}: ToolDeps): Tool[] {
  const image = config.image && {
    client: new OpenAI({
      baseURL: config.image.baseURL,
      apiKey: config.image.apiKey,
    }),
    model: config.image.model,
    files,
  }
  return [
    new CalculatorTool(),
    new FetchUrlTool(),
    new MemoryTool(memories),
    new SearchChatsTool(store),
    new SearchProjectFilesTool(projects, index),
    ...(config.braveApiKey ? [new WebSearchTool(config.braveApiKey)] : []),
    ...(image ? [new GenerateImageTool(image), new EditImageTool(image)] : []),
  ]
}

/**
 * Starts chibot: reads the configuration, opens the database and serves the
 * API (and the web app once built). `tools` builds the tools offered to the
 * model; the e2e tests add test-only ones.
 */
export function start({
  tools = defaultTools,
}: { tools?: (deps: ToolDeps) => Tool[] } = {}) {
  loadEnvFiles()

  const config = new Config(process.env)
  mkdirSync(config.dataDir, { recursive: true })
  const db = openDatabase(config.databasePath)
  const store = new ConversationStore(db)
  const settings = new SettingsStore(db, settingsDefaults(config.chat.model))
  const files = new FileStore(db, join(config.dataDir, 'files'))
  const memories = new MemoryStore(db)
  const projects = new ProjectStore(db, files)
  const index = new ProjectIndex(
    db,
    projects,
    files,
    config.embedding && {
      client: new OpenAI({
        baseURL: config.embedding.baseURL,
        apiKey: config.embedding.apiKey,
      }),
      model: config.embedding.model,
    },
  )
  void index.resume()
  // Temporary chats whose tab closed before it could delete them.
  store.deleteTemporaryConversations()
  const client = new OpenAI({
    baseURL: config.chat.baseURL,
    apiKey: config.chat.apiKey,
  })
  const mcp = new McpServers(mcpConfig(config), {
    disabled: () => settings.get().disabledMcpServers,
    auth: {
      store: new McpAuthStore(join(config.dataDir, 'mcp-auth.json')),
      redirectUrl: oauthRedirectUrl(config),
    },
  })
  void mcp.start()
  const registry = new ToolRegistry(
    tools({ config, store, files, memories, projects, index }),
    mcpTools(mcp, files),
  )
  const attachments = new Attachments(client, files)
  attachments.deleteOrphans()
  const chat = new ChatService(client, store, settings, {
    tools: registry,
    projects,
    attachments,
  })
  const app = createApp({
    config,
    store,
    settings,
    chat,
    files,
    memories,
    projects,
    index,
    attachments,
    transcription:
      config.transcription && Transcription.from(config.transcription),
  })

  // In dev, Vite serves the web app. The production build only exists after `pnpm build`.
  const webRoot = join(import.meta.dirname, '../../dist/web')
  if (existsSync(webRoot)) serveWebApp(app, webRoot)

  serve(
    { fetch: app.fetch, hostname: config.host, port: config.port },
    (info) => {
      console.log(`chibot listening on http://${config.host}:${info.port}`)
      if (config.token) {
        console.log(
          'Open it once in each browser with ?token=<CHIBOT_TOKEN> (from .env).',
        )
      } else if (!config.isLoopback) {
        console.warn(
          `Warning: HOST=${config.host} exposes chibot beyond this machine, with no authentication. Set CHIBOT_TOKEN to require a token.`,
        )
      }
    },
  )
}

/** The MCP servers in `mcp.json`; none, with the error, if it's invalid. */
function mcpConfig(config: Config): Record<string, McpServerConfig> {
  try {
    return loadMcpConfig(config.mcpConfigPath, process.env)
  } catch (err) {
    console.error(`MCP servers are off: ${(err as Error).message}`)
    return {}
  }
}

/**
 * Where OAuth providers send the browser back after an MCP server's sign-in:
 * chibot's own address (loopback for all interfaces), so the sign-in is done
 * on the machine running it.
 */
function oauthRedirectUrl({ host, port }: Config): string {
  const name = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host
  const origin = `http://${isIP(name) === 6 ? `[${name}]` : name}:${port}`
  return `${origin}/api/mcp/oauth/callback`
}

/**
 * Serves the built web app from `root`. Client-side routes such as /c/:id all
 * load the same page.
 */
export function serveWebApp(app: Hono, root: string): void {
  // The page names the build's content-hashed scripts, so browsers must check
  // it on every load: a cached copy after an upgrade names scripts that the
  // new build deleted, and the app stays blank until a hard reload. (Set
  // after serving: serveStatic's onFound runs too late to add headers.)
  app.use('/*', async (c, next) => {
    await next()
    if (c.res.headers.get('content-type')?.startsWith('text/html')) {
      c.header('Cache-Control', 'no-cache')
    }
  })
  app.use('/*', serveStatic({ root }))
  app.get('*', serveStatic({ root, path: 'index.html' }))
}

if (import.meta.main) start()
