#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import OpenAI from 'openai'
import { createApp } from './app.ts'
import { OAUTH_CALLBACK } from './mcp/index.ts'
import { Attachments } from './attachments.ts'
import { ChatService } from './chat/index.ts'
import { ModelRequests } from './chat/index.ts'
import { TitleWriter } from './chat/index.ts'
import { Config, loadEnvFiles } from './config.ts'
import { mcpVariables, readConfigFile, toEnv } from './config-file.ts'
import { locations } from './locations.ts'
import { InstructionWriter } from './projects/index.ts'
import { ConversationSearch } from './conversations/index.ts'
import { ConversationStore } from './conversations/index.ts'
import { openDatabase } from './database.ts'
import { FileStore } from './file-store.ts'
import { McpAuthStore } from './mcp/index.ts'
import { loadMcpConfig, type McpServerConfig } from './mcp/index.ts'
import { McpServers } from './mcp/index.ts'
import { MemoryStore } from './memory-store.ts'
import { ProjectIndex } from './projects/index.ts'
import { ProjectStore } from './projects/index.ts'
import { settingsDefaults, SettingsStore } from './settings-store.ts'
import type { Tool } from './tool.ts'
import { ToolRegistry } from './tool-registry.ts'
import { Transcription } from './transcription.ts'
import { FetchUrlTool } from './tools/fetch-url.ts'
import {
  EditImageTool,
  GenerateImageTool,
  imageClient,
} from './tools/images.ts'
import { mcpTools } from './mcp/index.ts'
import { MemoryTool } from './tools/memory.ts'
import { SearchProjectFilesTool } from './projects/index.ts'
import { ReadProjectFileTool } from './projects/index.ts'
import { SearchChatsTool } from './tools/search-chats.ts'
import { WebSearchTool } from './tools/web-search.ts'

/** What tools may need to be built. */
export interface ToolDeps {
  config: Config
  search: ConversationSearch
  files: FileStore
  memories: MemoryStore
  projects: ProjectStore
  index: ProjectIndex
  settings: SettingsStore
}

/** The shipped tools whose setup exists (e.g. a Brave key for web search). */
export function defaultTools({
  config,
  search,
  files,
  memories,
  projects,
  index,
  settings,
}: ToolDeps): Tool[] {
  const image = config.image && {
    client: imageClient(config.image),
    model: () => settings.get().imageModel,
    files,
  }
  return [
    new FetchUrlTool(),
    new MemoryTool(memories),
    new SearchChatsTool(search),
    new SearchProjectFilesTool(projects, index),
    new ReadProjectFileTool(projects, index),
    // Listed in Settings even without their setup, saying what's missing.
    new WebSearchTool(config.braveApiKey),
    new GenerateImageTool(image),
    new EditImageTool(image),
  ]
}

/**
 * Starts chibot: reads the configuration, opens the database and serves the
 * API (and the web app once built). `tools` builds the tools offered to the
 * model; the e2e tests add test-only ones.
 */
export function start({
  tools = defaultTools,
  env = {},
}: {
  tools?: (deps: ToolDeps) => Tool[]
  /** Settings beating the environment and `config.json` (command-line flags). */
  env?: Record<string, string>
} = {}) {
  const legacyEnv = loadEnvFiles()
  // Lowest first: config.json, then the environment, then the flags.
  const read = readConfigFile(locations({ ...process.env, ...env }).configDir)
  const config = new Config({ ...toEnv(read.file), ...process.env, ...env })
  if (read.exists) console.log(`Settings: ${read.path}`)
  if (read.tooOpen) {
    console.warn(
      `Warning: ${read.path} holds keys and others can read it. Run: chmod 600 "${read.path}"`,
    )
  }
  for (const path of legacyEnv) {
    console.warn(
      `Note: reading ${path}, which is no longer the place for settings. Run \`chibot init\` to move them into ${read.path}, then delete it.`,
    )
  }
  config.legacyNotes.forEach((note) => console.warn(`Note: ${note}`))
  mkdirSync(config.dataDir, { recursive: true })
  const db = openDatabase(config.databasePath)
  const store = new ConversationStore(db)
  const search = new ConversationSearch(db)
  const settings = new SettingsStore(
    db,
    settingsDefaults(config.chat.model, {
      imageModel: config.image?.model,
      embeddingModel: config.embedding?.model,
      transcribeModel: config.transcription?.model,
    }),
  )
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
      model: () => settings.get().embeddingModel,
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
    // Read again on each Reload, so a changed `env` in config.json is picked up.
    load: () =>
      loadMcpConfig(config.mcpConfigPath, mcpVariables(config.configDir)),
    auth: {
      store: new McpAuthStore(join(config.dataDir, 'mcp-auth.json')),
      redirectUrl: oauthRedirectUrl(config),
    },
  })
  void mcp.start()
  const registry = new ToolRegistry(
    tools({ config, search, files, memories, projects, index, settings }),
    mcpTools(mcp, files, () => settings.get().askMcpServers),
  )
  const attachments = new Attachments(client, files)
  attachments.deleteOrphans()
  const model = new ModelRequests(client, attachments)
  const titles = new TitleWriter(model, store, settings)
  const chat = new ChatService(model, titles, store, settings, {
    tools: registry,
    projects,
    attachments,
  })
  const app = createApp({
    config,
    store,
    search,
    settings,
    chat,
    titles,
    model,
    registry,
    files,
    memories,
    projects,
    index,
    instructionWriter: new InstructionWriter(client, settings, projects, index),
    attachments,
    mcp,
    transcription:
      config.transcription &&
      Transcription.from(
        config.transcription,
        () => settings.get().transcribeModel,
      ),
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
    return loadMcpConfig(config.mcpConfigPath, mcpVariables(config.configDir))
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
  return origin + OAUTH_CALLBACK
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
