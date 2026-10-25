import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Config } from '../../src/server/config.ts'
import { McpAuthStore } from '../../src/server/mcp-auth.ts'
import { McpServers } from '../../src/server/mcp-servers.ts'
import type { McpServerStatus } from '../../src/shared/types.ts'
import {
  startOAuthServer,
  type OAuthFixture,
} from '../fixtures/mcp-oauth-server.ts'
import { testApp, testSettings } from './fakes.ts'

const POST = { method: 'POST' }
const CALLBACK = 'http://127.0.0.1:8787/api/mcp/oauth/callback'

describe('MCP routes', () => {
  let provider: OAuthFixture
  let dir: string
  let mcp: McpServers
  beforeAll(async () => {
    provider = await startOAuthServer()
    dir = mkdtempSync(join(tmpdir(), 'chibot-mcp-routes-'))
  })
  afterEach(() => mcp.close())
  afterAll(async () => {
    await provider.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const chibot = async (env: Record<string, string> = {}) => {
    const settings = testSettings()
    mcp = new McpServers(
      {
        fixture: {
          type: 'local',
          command: process.execPath,
          args: [join(import.meta.dirname, '../fixtures/mcp-server.ts')],
        },
        tracker: { type: 'remote', url: provider.url },
      },
      {
        disabled: () => settings.get().disabledMcpServers,
        auth: {
          store: new McpAuthStore(join(dir, `${crypto.randomUUID()}.json`)),
          redirectUrl: CALLBACK,
        },
      },
    )
    await mcp.start()
    return testApp({
      config: new Config({ OPENAI_API_KEY: 'k', ...env }),
      settings,
      mcp,
    })
  }
  const statuses = async (res: Response | Promise<Response>) => {
    const { servers } = (await (await res).json()) as {
      servers: McpServerStatus[]
    }
    return Object.fromEntries(servers.map((s) => [s.name, s]))
  }

  it('list the servers, and switch them off and on', async () => {
    const app = await chibot()
    let servers = await statuses(app.request('/api/mcp'))
    expect(servers.fixture).toMatchObject({
      state: 'connected',
      signedIn: null,
    })
    expect(servers.fixture!.tools[0]).toEqual({
      name: 'fixture__echo',
      title: 'Echo',
      description: 'Repeats the text',
    })
    expect(servers.tracker).toMatchObject({
      state: 'needs-sign-in',
      signedIn: false,
    })
    await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabledMcpServers: ['fixture'] }),
    })
    servers = await statuses(app.request('/api/mcp'))
    expect(servers.fixture!.state).toBe('disabled')

    servers = await statuses(app.request('/api/mcp/fixture/reconnect', POST))
    expect(servers.fixture!.state).toBe('connected')
    expect((await app.request('/api/mcp/nope/reconnect', POST)).status).toBe(
      404,
    )
  })

  it('sign in through the provider and come back to Settings', async () => {
    const app = await chibot()
    const signIn = await app.request(
      'http://localhost:8787/api/mcp/tracker/sign-in',
      POST,
    )
    const { url } = (await signIn.json()) as { url: string }
    const back = new URL(
      (await fetch(url, { redirect: 'manual' })).headers.get('location')!,
    )

    const forged = await app.request(
      `/api/mcp/oauth/callback?code=x&state=forged`,
    )
    expect(forged.status).toBe(400)

    const callback = await app.request(back.pathname + back.search)
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe(
      'http://localhost:8787/?settings=tools',
    )
    const servers = await statuses(app.request('/api/mcp'))
    expect(servers.tracker).toMatchObject({
      state: 'connected',
      signedIn: true,
    })

    expect(
      (await statuses(app.request('/api/mcp/tracker/sign-out', POST))).tracker,
    ).toMatchObject({ state: 'needs-sign-in', signedIn: false })
    // Local servers have no sign-in.
    expect((await app.request('/api/mcp/fixture/sign-in', POST)).status).toBe(
      400,
    )
  })

  it('let the provider’s redirect in without the access token', async () => {
    const app = await chibot({ CHIBOT_TOKEN: 'a-long-enough-token' })
    expect((await app.request('/api/mcp')).status).toBe(401)
    // Reaches the state check, rather than the token's 401.
    expect(
      (await app.request('/api/mcp/oauth/callback?code=x&state=y')).status,
    ).toBe(400)
  })
})
