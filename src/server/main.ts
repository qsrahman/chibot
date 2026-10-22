#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.ts'
import { Config } from './config.ts'

try {
  process.loadEnvFile()
} catch (err) {
  // A missing .env is fine: variables may come from the real environment.
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
}

const config = new Config(process.env)
const app = createApp({ config })

// In dev, Vite serves the web app. The production build only exists after `pnpm build`.
const webRoot = join(import.meta.dirname, '../../dist/web')
if (existsSync(webRoot)) {
  app.use('/*', serveStatic({ root: webRoot }))
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
