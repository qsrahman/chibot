import { Hono } from 'hono'
import {
  settingsPatchSchema,
  type SettingsResponse,
} from '../../shared/settings.ts'
import type { ModelsResponse, ToolInfo } from '../../shared/types.ts'
import type { AppDeps } from '../app.ts'
import { json } from './helpers.ts'

export function settingsRoutes({ settings, chat, mcp }: AppDeps) {
  const app = new Hono()

  app.get('/api/settings', (c) =>
    c.json({
      settings: settings.get(),
      defaults: settings.defaults,
    } satisfies SettingsResponse),
  )

  // Whether each is on is the `disabledTools` setting.
  app.get('/api/tools', (c) =>
    c.json({ tools: chat.tools } satisfies { tools: ToolInfo[] }),
  )

  app.patch('/api/settings', json(settingsPatchSchema), async (c) => {
    const updated = settings.update(c.req.valid('json'))
    // Switched MCP servers connect or stop.
    await mcp.sync()
    return c.json(updated)
  })

  app.get('/api/models', async (c) =>
    c.json({ models: await chat.listModels() } satisfies ModelsResponse),
  )

  return app
}
