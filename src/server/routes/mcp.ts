import { Hono, type Context } from 'hono'
import type { McpServerStatus } from '../../shared/types.ts'
import type { AppDeps } from '../app.ts'
import { notFound } from './helpers.ts'

export function mcpRoutes({ mcp }: AppDeps) {
  const app = new Hono()

  const mcpStatus = (c: Context) =>
    c.json({ servers: mcp.statuses() } satisfies {
      servers: McpServerStatus[]
    })
  app.get('/api/mcp', mcpStatus)
  app.use(
    '/api/mcp/:name/:action{reconnect|sign-in|sign-out}',
    async (c, next) => {
      if (!mcp.has(c.req.param('name'))) return notFound(c, 'MCP server')
      await next()
    },
  )
  // mcp.json may have been edited since chibot started.
  app.post('/api/mcp/reload', async (c) => {
    try {
      await mcp.reload()
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
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
      return c.json({ error: (err as Error).message }, 400)
    }
  })
  app.post('/api/mcp/:name/sign-out', async (c) => {
    try {
      await mcp.signOut(c.req.param('name'))
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
    return mcpStatus(c)
  })
  app.get(OAUTH_CALLBACK, async (c) => {
    try {
      return c.redirect(await mcp.finishSignIn(new URL(c.req.url).searchParams))
    } catch (err) {
      return c.text((err as Error).message, 400)
    }
  })

  return app
}

/** Where OAuth providers send the browser back after an MCP sign-in. */
export const OAUTH_CALLBACK = '/api/mcp/oauth/callback'
