import { Hono } from 'hono'
import {
  settingsPatchSchema,
  type SettingsResponse,
} from '../../shared/settings.ts'
import type { ToolInfo } from '../../shared/tools.ts'
import type { ModelsResponse } from '../../shared/types.ts'
import type { ModelRequests } from '../chat/index.ts'
import type { McpServers } from '../mcp/index.ts'
import type { SettingsStore } from '../settings-store.ts'
import type { ToolRegistry } from '../tool-registry.ts'
import { json } from './helpers.ts'

export function settingsRoutes({
  settings,
  registry,
  model,
  mcp,
}: {
  settings: SettingsStore
  registry: ToolRegistry
  model: ModelRequests
  mcp: McpServers
}) {
  const app = new Hono()

  app.get('/api/settings', (c) =>
    c.json({
      settings: settings.get(),
      defaults: settings.defaults,
    } satisfies SettingsResponse),
  )

  // Whether each is on is the `disabledTools` setting.
  app.get('/api/tools', (c) =>
    c.json({ tools: registry.info } satisfies { tools: ToolInfo[] }),
  )

  app.patch('/api/settings', json(settingsPatchSchema), async (c) => {
    const updated = settings.update(c.req.valid('json'))
    // Switched MCP servers connect or stop.
    await mcp.sync()
    return c.json(updated)
  })

  app.get('/api/models', async (c) =>
    c.json({ models: await model.listModels() } satisfies ModelsResponse),
  )

  return app
}
