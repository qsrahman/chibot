#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import OpenAI from 'openai'
import { createApp } from './app.ts'
import { ChatService } from './chat-service.ts'
import { Config, loadEnvFiles } from './config.ts'
import { ConversationStore } from './conversation-store.ts'
import { openDatabase } from './database.ts'
import { FileStore } from './file-store.ts'
import { settingsDefaults, SettingsStore } from './settings-store.ts'
import type { Tool } from './tool.ts'
import { ToolRegistry } from './tool-registry.ts'
import { CalculatorTool } from './tools/calculator.ts'
import { FetchUrlTool } from './tools/fetch-url.ts'
import { WebSearchTool } from './tools/web-search.ts'

/** What tools may need to be built. */
export interface ToolDeps {
  config: Config
  files: FileStore
}

/** The shipped tools whose setup exists (e.g. a Brave key for web search). */
export function defaultTools({ config }: ToolDeps): Tool[] {
  return [
    new CalculatorTool(),
    new FetchUrlTool(),
    ...(config.braveApiKey ? [new WebSearchTool(config.braveApiKey)] : []),
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
  // Temporary chats whose tab closed before it could delete them.
  store.deleteTemporaryConversations()
  files.deleteOrphans()
  const client = new OpenAI({
    baseURL: config.chat.baseURL,
    apiKey: config.chat.apiKey,
  })
  const registry = new ToolRegistry(tools({ config, files }))
  const chat = new ChatService(client, store, settings, registry)
  const app = createApp({ config, store, settings, chat, files })

  // In dev, Vite serves the web app. The production build only exists after `pnpm build`.
  const webRoot = join(import.meta.dirname, '../../dist/web')
  if (existsSync(webRoot)) {
    app.use('/*', serveStatic({ root: webRoot }))
    // Client-side routes such as /c/:id all load the same page.
    app.get('*', serveStatic({ root: webRoot, path: 'index.html' }))
  }

  serve(
    { fetch: app.fetch, hostname: config.host, port: config.port },
    (info) => {
      console.log(`chibot listening on http://${config.host}:${info.port}`)
      if (!config.isLoopback) {
        console.warn(
          `Warning: HOST=${config.host} exposes chibot beyond this machine, with no authentication.`,
        )
      }
    },
  )
}

if (import.meta.main) start()
