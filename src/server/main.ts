#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import OpenAI from 'openai'
import { createApp } from './app.ts'
import { ChatService } from './chat-service.ts'
import { Config } from './config.ts'
import { ConversationStore } from './conversation-store.ts'

try {
  process.loadEnvFile()
} catch (err) {
  // A missing .env is fine: variables may come from the real environment.
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
}

const config = new Config(process.env)
mkdirSync(config.dataDir, { recursive: true })
const store = new ConversationStore(config.databasePath)
// Temporary chats whose tab closed before it could delete them.
store.deleteTemporaryConversations()
const client = new OpenAI({
  baseURL: config.chat.baseURL,
  apiKey: config.chat.apiKey,
})
const chat = new ChatService(client, store, config.chat.model)
const app = createApp({ config, store, chat })

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
