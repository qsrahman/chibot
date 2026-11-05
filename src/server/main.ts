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
import { Config, layered, readEnvFiles } from './config.ts'
import { mcpVariables, readConfigFile } from './config-file.ts'
import { locations, openFolders, ROOT } from './locations.ts'
import { InstructionWriter } from './projects/index.ts'
import { ConversationSearch } from './conversations/index.ts'
import { ConversationStore } from './conversations/index.ts'
import { openDatabase } from './database.ts'
import { FileStore } from './file-store.ts'
import { McpAuthStore } from './mcp/index.ts'
import {
  loadMcpConfig,
  parseMcpConfig,
  type McpServerConfig,
} from './mcp/index.ts'
import { McpServers } from './mcp/index.ts'
import { MemoryStore } from './memory-store.ts'
import { ProjectIndex } from './projects/index.ts'
import { ProjectStore } from './projects/index.ts'
import { settingsDefaults, SettingsStore } from './settings-store.ts'
import type { Tool } from './tool.ts'
import { ToolRegistry } from './tool-registry.ts'
import { Transcription } from './transcription.ts'
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

/** The shipped tools; web search and reading pages come from MCP servers. */
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
    new MemoryTool(memories),
    new SearchChatsTool(search),
    new SearchProjectFilesTool(projects, index),
    new ReadProjectFileTool(projects, index),
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
}: {
  tools?: (deps: ToolDeps) => Tool[]
  /** Settings beating the environment and `config.json` (command-line flags). */
  env?: Record<string, string>
} = {}) {
  const legacy = readEnvFiles()
  // Where config.json is can itself come from an old .env, the environment or a flag.
  const read = readConfigFile(
    locations({ ...legacy.values, ...process.env, ...env }).configDir,
  )
  const config = new Config(
    layered({
      legacy: legacy.values,
      file: read.file,
      env: process.env,
      flags: env,
    }),
  )
  if (read.exists) console.log(`Settings: ${read.path}`)
  for (const name of read.obsolete) {
    console.warn(
      `Note: ${name} in ${read.path} is no longer used (web search and reading pages come from MCP servers) and is left out the next time chibot saves it.`,
    )
  }
  if (read.tooOpen) {
    console.warn(
      `Warning: ${read.path} holds keys and others can read it. Run: chmod 600 "${read.path}"`,
    )
  }
  for (const path of legacy.files) {
    console.warn(
      `Note: reading ${path}, which is no longer the place for settings. Run \`chibot init\` to move them into ${read.path}, then delete it.`,
    )
  }
  config.legacyNotes.forEach((note) => console.warn(`Note: ${note}`))
  if (
    !config.mcpConfigExplicit &&
    !read.file.mcpServers &&
    existsSync(config.mcpConfigPath)
  ) {
    console.warn(
      `Note: reading MCP servers from ${config.mcpConfigPath}; they can live in ${read.path} under "mcpServers". Run \`chibot init\` to move them.`,
    )
  }
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
    // Read again on each Reload, so a changed config.json is picked up.
    load: () => loadMcpServers(config),
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

/**
 * The MCP servers to use. `CHIBOT_MCP_CONFIG`, if given, names the file;
 * otherwise `mcpServers` in `config.json`, else the older standalone
 * `mcp.json`. `${VAR}` is filled from the environment, then `config.json`'s
 * `env`. Throws, saying what is wrong, so Reload can show it.
 */
export function loadMcpServers(
  config: Config,
): Record<string, McpServerConfig> {
  const { file } = readConfigFile(config.configDir)
  const variables = mcpVariables(config.configDir)
  if (file.mcpServers && !config.mcpConfigExplicit) {
    return parseMcpConfig(
      { mcpServers: file.mcpServers },
      variables,
      'config.json',
    )
  }
  return loadMcpConfig(config.mcpConfigPath, variables)
}

/** The MCP servers at startup; none, with the error, if they are invalid. */
function mcpConfig(config: Config): Record<string, McpServerConfig> {
  try {
    return loadMcpServers(config)
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
