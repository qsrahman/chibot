import { Hono } from 'hono'
import type { Config } from './config.ts'

export interface AppDeps {
  config: Config
}

/** Builds the HTTP app. A factory so tests can inject fakes. */
export function createApp({ config }: AppDeps) {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ status: 'ok', model: config.model }))

  return app
}
