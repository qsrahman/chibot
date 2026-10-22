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
import { settingsDefaults, SettingsStore } from './settings-store.ts'

loadEnvFiles()

const config = new Config(process.env)
mkdirSync(config.dataDir, { recursive: true })
const db = openDatabase(config.databasePath)
const store = new ConversationStore(db)
const settings = new SettingsStore(db, settingsDefaults(config.chat.model))
// Temporary chats whose tab closed before it could delete them.
store.deleteTemporaryConversations()
const client = new OpenAI({
  baseURL: config.chat.baseURL,
  apiKey: config.chat.apiKey,
})
const chat = new ChatService(client, store, settings)
const app = createApp({ config, store, settings, chat })

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
