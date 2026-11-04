import { Hono } from 'hono'
import {
  settingsPatchSchema,
  type SettingsResponse,
} from '../../shared/settings.ts'
import type { ToolInfo } from '../../shared/tools.ts'
import type { ModelsResponse } from '../../shared/types.ts'
import type { ModelRequests } from '../chat/index.ts'
import type { McpServers } from '../mcp/index.ts'
import type { ProjectIndex } from '../projects/index.ts'
import type { Config } from '../config.ts'
import type { SettingsStore } from '../settings-store.ts'
import type { ToolRegistry } from '../tool-registry.ts'
import { json } from './helpers.ts'

type ServiceEndpoints = 'image' | 'embedding' | 'transcription'

export function settingsRoutes({
  settings,
  registry,
  model,
  mcp,
  index,
  config,
}: {
  settings: SettingsStore
  registry: ToolRegistry
  model: ModelRequests
  mcp: McpServers
  index: ProjectIndex
  config: Pick<Config, ServiceEndpoints>
}) {
  const app = new Hono()

  app.get('/api/settings', (c) =>
    c.json({
      settings: settings.get(),
      defaults: settings.defaults,
      endpoints: {
        imageModel: config.image !== null,
        embeddingModel: config.embedding !== null,
        transcribeModel: config.transcription !== null,
      },
    } satisfies SettingsResponse),
  )

  // Whether each is on is the `disabledTools` setting.
  app.get('/api/tools', (c) =>
    c.json({ tools: registry.info } satisfies { tools: ToolInfo[] }),
  )

  app.patch('/api/settings', json(settingsPatchSchema), async (c) => {
    const patch = c.req.valid('json')
    const updated = settings.update(patch)
    // A new embedding model: files are embedded again in the background
    // (vectors of different models don't mix); searching meanwhile is by keyword.
    if (patch.embeddingModel !== undefined) void index.resume()
    // Switched MCP servers connect or stop.
    await mcp.sync()
    return c.json(updated)
  })

  app.get('/api/models', async (c) =>
    c.json({ models: await model.listModels() } satisfies ModelsResponse),
  )

  return app
}
