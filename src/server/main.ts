#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import OpenAI from 'openai'
import { createApp } from './app.ts'
import { WEB_ROOT } from './build-id.ts'
import { Attachments } from './attachments.ts'
import {
  ChatService,
  Compactor,
  ModelRequests,
  TitleWriter,
} from './chat/index.ts'
import { Config, layered } from './config.ts'
import {
  readConfigFile,
  readDisabledTools,
  writeDisabledTools,
} from './config-file.ts'
import { localOrigin } from './local-origin.ts'
import { MediaProxy, type AddressGuard } from './media-proxy.ts'
import { openBrowser } from './open-browser.ts'
import { locations, openFolders, ROOT } from './locations.ts'
import { ConversationSearch, ConversationStore } from './conversations/index.ts'
import { openDatabase } from './database.ts'
import { FileStore } from './file-store.ts'
import {
  ListMcpResourcesTool,
  loadMcpServers,
  McpAuthStore,
  McpServers,
  mcpServerFile,
  mcpServersAtStartup,
  mcpTools,
  oauthRedirectUrl,
  ReadMcpResourceTool,
} from './mcp/index.ts'
import { MemoryStore } from './memory-store.ts'
import {
  FolderWatcher,
  InstructionWriter,
  ProjectIndex,
  ProjectStore,
  ProjectSync,
  ReadProjectFileTool,
  Reranker,
  SearchProjectFilesTool,
} from './projects/index.ts'
import { settingsDefaults, SettingsStore } from './settings-store.ts'
import { reportConfig } from './startup-notes.ts'
import type { Tool } from './tool.ts'
import { ToolRegistry } from './tool-registry.ts'
import { Transcription } from './transcription.ts'
import {
  EditImageTool,
  GenerateImageTool,
  imageClient,
} from './tools/images.ts'
import { MemoryTool } from './tools/memory.ts'
import { SearchChatsTool } from './tools/search-chats.ts'
import { ReadSkillTool, SkillStore } from './skills/index.ts'

/** What tools may need to be built. */
export interface ToolDeps {
  config: Config
  search: ConversationSearch
  files: FileStore
  memories: MemoryStore
  projects: ProjectStore
  index: ProjectIndex
  settings: SettingsStore
  skills: SkillStore
  mcp: McpServers
}

/** The shipped tools; web search and reading pages come from MCP servers. */
export function defaultTools({
  config,
  search,
  files,
  memories,
  projects,
  index,
  settings,
  skills,
  mcp,
}: ToolDeps): Tool[] {
  const image = config.image && {
    client: imageClient(config.image),
    model: () => settings.get().imageModel,
    files,
  }
  return [
    new MemoryTool(memories),
    new SearchChatsTool(search),
    new SearchProjectFilesTool(projects, index),
    new ReadProjectFileTool(projects, index),
    new ReadSkillTool(skills, () => settings.get().disabledTools),
    // Offered only while a connected MCP server has resources.
    new ListMcpResourcesTool(mcp),
    new ReadMcpResourceTool(mcp),
    // Listed in Settings even without their setup, saying what's missing.
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
  mediaGuard,
  open = false,
}: {
  tools?: (deps: ToolDeps) => Tool[]
  /** Settings beating the environment and `config.json` (command-line flags). */
  env?: Record<string, string>
  /** Which addresses linked images and media may be fetched from (tests allow their own). */
  mediaGuard?: AddressGuard
  /** Open chibot in the default browser once it listens (the command line does; tests don't). */
  open?: boolean
} = {}) {
  // Where config.json is can itself come from the environment or a flag.
  const read = readConfigFile(locations({ ...process.env, ...env }).configDir)
  const config = new Config(
    layered({ file: read.file, env: process.env, flags: env }),
  )
  if (config.exposure) throw new Error(config.exposure)
  reportConfig(read)
  // Chats and files: for the owner only (the config folder is 0700 too).
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  for (const dir of openFolders([config.dataDir, config.configDir])) {
    console.warn(
      `Warning: other users of this machine can open ${dir}, which holds your chats and keys. Run: chmod 700 "${dir}"`,
    )
  }
  const db = openDatabase(config.databasePath)
  const store = new ConversationStore(db)
  const search = new ConversationSearch(db)
  const settings = new SettingsStore(
    db,
    settingsDefaults(config.chat.model, {
      imageModel: config.image?.model,
      embeddingModel: config.embedding?.model,
      rerankModel: config.rerank?.model,
      transcribeModel: config.transcription?.model,
    }),
    {
      read: () => readDisabledTools(config.configDir),
      write: (tools) => writeDisabledTools(config.configDir, tools),
    },
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
      prefixes: () => ({
        query: settings.get().embeddingQueryPrefix,
        document: settings.get().embeddingDocumentPrefix,
      }),
    },
    config.rerank?.baseURL
      ? new Reranker({
          baseURL: config.rerank.baseURL,
          apiKey: config.rerank.apiKey,
          model: () => settings.get().rerankModel,
        })
      : null,
  )
  void index.resume()
  const sync = new ProjectSync(projects, files, index)
  // Mirrored folders: catch up with what changed while chibot was off, then
  // follow the changes.
  const watcher = new FolderWatcher(projects, sync)
  watcher.startAll()
  // Temporary chats whose tab closed before it could delete them.
  store.deleteTemporaryConversations()
  const client = new OpenAI({
    baseURL: config.chat.baseURL,
    apiKey: config.chat.apiKey,
  })
  const mcp = new McpServers(mcpServersAtStartup(config), {
    // Read again on each Reload, so a changed config.json is picked up.
    load: () => loadMcpServers(config),
    auth: {
      store: new McpAuthStore(join(config.dataDir, 'mcp-auth.json')),
      redirectUrl: oauthRedirectUrl(config),
    },
  })
  void mcp.start()
  // Folders of instructions the user adds (see skills/).
  const skills = new SkillStore(join(config.configDir, 'skills'))
  const registry = new ToolRegistry(
    tools({
      config,
      search,
      files,
      memories,
      projects,
      index,
      settings,
      skills,
      mcp,
    }),
    mcpTools(mcp, files),
  )
  const attachments = new Attachments(client, files)
  attachments.deleteOrphans()
  const model = new ModelRequests(client, attachments)
  const titles = new TitleWriter(model, store, settings)
  const compactor = new Compactor(model, store, settings)
  const chat = new ChatService(model, titles, compactor, store, settings, {
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
    compactor,
    titles,
    model,
    registry,
    files,
    memories,
    projects,
    index,
    sync,
    watcher,
    skills,
    instructionWriter: new InstructionWriter(client, settings, projects, index),
    attachments,
    mcp,
    mcpFile: mcpServerFile(config),
    media: new MediaProxy(mediaGuard && { allowed: mediaGuard }),
    transcription:
      config.transcription &&
      Transcription.from(
        config.transcription,
        () => settings.get().transcribeModel,
      ),
  })

  // In dev, Vite serves the web app. The production build only exists after `pnpm build`.
  const webRoot = WEB_ROOT
  if (existsSync(webRoot)) {
    serveWebApp(app, webRoot)
  } else {
    // A linked `chibot` run before `pnpm build`: say so, not a bare 404.
    app.get('*', (c) =>
      c.text(
        `chibot is running, but its web app is not built yet.\nIn ${ROOT}, run: pnpm build\n`,
        503,
      ),
    )
  }

  serve(
    { fetch: app.fetch, hostname: config.host, port: config.port },
    (info) => {
      console.log(`chibot listening on http://${config.host}:${info.port}`)
      // With a token the address needs it once, and a secret doesn't belong
      // in a command line or the browser's history, so that is left to the user.
      if (open && !config.token) {
        openBrowser(localOrigin({ host: config.host, port: info.port }))
      }
      if (config.token) {
        console.log(
          'Open it once in each browser with ?token=<your token> (the token in config.json, or CHIBOT_TOKEN).',
        )
      } else if (!config.isLoopback) {
        console.warn(
          `Warning: HOST=${config.host} exposes chibot beyond this machine with no authentication (CHIBOT_ALLOW_OPEN is set).`,
        )
      }
    },
  )
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
