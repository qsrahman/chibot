// A remote MCP server for tests (the fixture's tools over streamable HTTP)
// behind a minimal OAuth authorization server: dynamic registration, an
// /authorize that signs in at once, and PKCE-checked tokens. With `open`,
// /mcp needs no token.
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { Hono } from 'hono'
import { fixtureServer } from './mcp-server.ts'

export interface OAuthFixture {
  /** The MCP endpoint. */
  url: string
  /** Access tokens handed out (the latest last); revoke by clearing it. */
  tokens: string[]
  /** Clients registered. */
  clients: number
  close: () => Promise<void>
}

export async function startOAuthServer({
  port = 0,
  open = false,
}: { port?: number; open?: boolean } = {}): Promise<OAuthFixture> {
  const app = new Hono()
  const mcp = createMcpHandler(() => fixtureServer())
  const codes = new Map<string, { challenge: string; redirectUri: string }>()
  let origin = ''
  const fixture: OAuthFixture = {
    url: '',
    tokens: [],
    clients: 0,
    close: async () => {},
  }

  app.get('/.well-known/oauth-protected-resource/*', (c) =>
    c.json({ resource: `${origin}/mcp`, authorization_servers: [origin] }),
  )
  app.get('/.well-known/oauth-authorization-server', (c) =>
    c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    }),
  )
  app.post('/register', async (c) => {
    fixture.clients++
    return c.json(
      { ...(await c.req.json()), client_id: `client-${fixture.clients}` },
      201,
    )
  })
  app.get('/authorize', (c) => {
    const code = crypto.randomUUID()
    const redirectUri = c.req.query('redirect_uri')!
    codes.set(code, {
      challenge: c.req.query('code_challenge')!,
      redirectUri,
    })
    const back = new URL(redirectUri)
    back.searchParams.set('code', code)
    back.searchParams.set('state', c.req.query('state') ?? '')
    back.searchParams.set('iss', origin)
    return c.redirect(back.href)
  })
  app.post('/token', async (c) => {
    const form = await c.req.parseBody()
    if (form.grant_type === 'authorization_code') {
      const pending = codes.get(String(form.code))
      codes.delete(String(form.code))
      const challenge = createHash('sha256')
        .update(String(form.code_verifier))
        .digest('base64url')
      if (!pending || pending.challenge !== challenge) {
        return c.json({ error: 'invalid_grant' }, 400)
      }
    }
    const token = crypto.randomUUID()
    fixture.tokens.push(token)
    return c.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: crypto.randomUUID(),
    })
  })
  app.all('/mcp', async (c) => {
    const token = c.req.header('authorization')?.replace(/^Bearer /, '')
    if (!open && !(token && fixture.tokens.includes(token))) {
      c.header(
        'WWW-Authenticate',
        `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      )
      return c.json({ error: 'invalid_token' }, 401)
    }
    return mcp.fetch(c.req.raw)
  })

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () =>
      resolve(s),
    )
  })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  fixture.url = `${origin}/mcp`
  fixture.close = async () => {
    await mcp.close()
    await new Promise((resolve) => server.close(resolve))
  }
  return fixture
}
