import { z } from 'zod'
import { Hono, type Context } from 'hono'
import type { McpServerStatus } from '../../shared/types.ts'
import {
  mcpServerName,
  mcpServerSchema,
  mcpSwitchSchema,
  type McpSwitch,
} from '../../shared/mcp.ts'
import type { SettingsStore } from '../settings-store.ts'
import type { McpServers } from './mcp-servers.ts'
import type { McpServerFile } from './server-file.ts'
import { json, notFound } from '../routes/helpers.ts'
import { errorMessage } from '../../shared/errors.ts'

export function mcpRoutes({
  mcp,
  mcpFile,
  settings,
}: {
  mcp: McpServers
  mcpFile: McpServerFile
  settings: SettingsStore
}) {
  const app = new Hono()

  const mcpStatus = (c: Context) =>
    c.json({ servers: mcp.statuses() } satisfies {
      servers: McpServerStatus[]
    })
  app.get('/api/mcp', mcpStatus)
  // Before the :name routes below: `definitions` is not a server.
  app.get('/api/mcp/definitions', (c) => c.json(mcpFile.describe()))
  app.put('/api/mcp/servers/:name', json(mcpServerSchema), async (c) => {
    const name = c.req.param('name')
    try {
      mcpServerName.parse(name)
      mcpFile.put(name, c.req.valid('json'))
      await mcp.reload()
    } catch (err) {
      return c.json({ error: failure(err) }, 400)
    }
    return mcpStatus(c)
  })
  // A switch of Settings → Tools: kept in the server's entry in the config file.
  app.patch('/api/mcp/servers/:name', json(mcpSwitchSchema), async (c) => {
    const name = c.req.param('name')
    const change = c.req.valid('json')
    try {
      mcpFile.setSwitch(name, change)
      forgetOldSwitches(settings, name, change)
      await mcp.reload()
    } catch (err) {
      return c.json({ error: failure(err) }, 400)
    }
    return mcpStatus(c)
  })
  app.delete('/api/mcp/servers/:name', async (c) => {
    try {
      mcpFile.remove(c.req.param('name'))
      await mcp.reload()
    } catch (err) {
      return c.json({ error: failure(err) }, 400)
    }
    return mcpStatus(c)
  })
  app.use(
    '/api/mcp/:name/:action{reconnect|sign-in|sign-out}',
    async (c, next) => {
      if (!mcp.has(c.req.param('name'))) return notFound(c, 'MCP server')
      await next()
    },
  )
  // The config may have been edited since chibot started.
  app.post('/api/mcp/reload', async (c) => {
    try {
      await mcp.reload()
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400)
    }
    return mcpStatus(c)
  })
  app.post('/api/mcp/:name/reconnect', async (c) => {
    await mcp.connect(c.req.param('name'))
    return mcpStatus(c)
  })
  app.post('/api/mcp/:name/sign-in', async (c) => {
    try {
      // Back to the address the user is on, with Settings → Tools open.
      const returnTo = new URL('/?settings=tools', c.req.url).href
      const url = await mcp.signIn(c.req.param('name'), returnTo)
      return c.json({ url: url?.href ?? null })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400)
    }
  })
  app.post('/api/mcp/:name/sign-out', async (c) => {
    try {
      await mcp.signOut(c.req.param('name'))
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400)
    }
    return mcpStatus(c)
  })
  app.get(OAUTH_CALLBACK, async (c) => {
    try {
      return c.redirect(await mcp.finishSignIn(new URL(c.req.url).searchParams))
    } catch (err) {
      return c.text(errorMessage(err), 400)
    }
  })

  return app
}

/**
 * What the switch settled is in the config file now: the settings' older
 * lists no longer say anything about it (they would otherwise come back if
 * the entry's switch is removed).
 */
function forgetOldSwitches(
  settings: SettingsStore,
  server: string,
  change: McpSwitch,
) {
  const now = settings.get()
  const without = (list: string[], name: string) =>
    list.filter((entry) => entry !== name)
  const patch: Partial<typeof now> = {}
  if (change.enabled !== undefined && now.disabledMcpServers.includes(server)) {
    patch.disabledMcpServers = without(now.disabledMcpServers, server)
  }
  if (change.ask !== undefined && now.askMcpServers.includes(server)) {
    patch.askMcpServers = without(now.askMcpServers, server)
  }
  const prefixed = `${server}__${change.tool?.name}`
  if (change.tool && now.disabledTools.includes(prefixed)) {
    patch.disabledTools = without(now.disabledTools, prefixed)
  }
  if (Object.keys(patch).length > 0) settings.update(patch)
}

const failure = (err: unknown) =>
  err instanceof z.ZodError ? z.prettifyError(err) : errorMessage(err)

/** Where OAuth providers send the browser back after an MCP sign-in. */
export const OAUTH_CALLBACK = '/api/mcp/oauth/callback'
