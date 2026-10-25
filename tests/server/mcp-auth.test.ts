import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { McpAuthStore } from '../../src/server/mcp-auth.ts'
import type { McpServerConfig } from '../../src/server/mcp-config.ts'
import { McpServers } from '../../src/server/mcp-servers.ts'
import {
  startOAuthServer,
  type OAuthFixture,
} from '../fixtures/mcp-oauth-server.ts'

const redirectUrl = 'http://127.0.0.1:8787/api/mcp/oauth/callback'

/** Follows the provider's redirect, as the browser would. */
async function authorize(url: URL): Promise<URLSearchParams> {
  const res = await fetch(url, { redirect: 'manual' })
  const back = new URL(res.headers.get('location')!)
  expect(back.origin + back.pathname).toBe(redirectUrl)
  return back.searchParams
}

describe('MCP sign-in', () => {
  let provider: OAuthFixture
  let dir: string
  let path: string
  let all: McpServers[] = []
  beforeAll(async () => {
    provider = await startOAuthServer()
    dir = mkdtempSync(join(tmpdir(), 'chibot-mcp-auth-'))
    path = join(dir, 'mcp-auth.json')
  })
  afterEach(async () => {
    await Promise.all(all.map((s) => s.close()))
    all = []
  })
  afterAll(async () => {
    await provider.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const start = async (configs: Record<string, McpServerConfig>) => {
    const servers = new McpServers(configs, {
      disabled: () => [],
      auth: { store: new McpAuthStore(path), redirectUrl },
    })
    all.push(servers)
    await servers.start()
    return servers
  }
  const status = (servers: McpServers, name = 'tracker') =>
    servers.statuses().find((s) => s.name === name)!

  it('signs in through the browser, keeps the tokens and signs out', async () => {
    const tracker = { type: 'remote', url: provider.url } as const
    let servers = await start({ tracker })
    expect(status(servers)).toMatchObject({
      state: 'needs-sign-in',
      signedIn: false,
      error: null,
    })

    const url = await servers.signIn('tracker', 'http://localhost:8787/')
    const params = await authorize(url!)

    // Only a state chibot handed out.
    const forged = new URLSearchParams(params)
    forged.set('state', 'forged')
    await expect(servers.finishSignIn(forged)).rejects.toThrow(/unknown/)

    expect(await servers.finishSignIn(params)).toBe('http://localhost:8787/')
    expect(status(servers)).toMatchObject({
      state: 'connected',
      signedIn: true,
    })
    const result = await servers.callTool('tracker__echo', { text: 'hi' })
    expect(result.content).toEqual([{ type: 'text', text: 'echo: hi' }])
    // Each state works once.
    await expect(servers.finishSignIn(params)).rejects.toThrow(/used already/)

    // Only the owner can read the tokens.
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8')).toContain(provider.tokens.at(-1))

    // After a restart, the kept tokens and registration are used.
    await servers.close()
    servers = await start({ tracker })
    expect(status(servers).state).toBe('connected')
    expect(provider.clients).toBe(1)

    const token = provider.tokens.at(-1)!
    await servers.signOut('tracker')
    expect(status(servers)).toMatchObject({
      state: 'needs-sign-in',
      signedIn: false,
    })
    expect(readFileSync(path, 'utf8')).not.toContain(token)
  })

  it('reports a refused sign-in without showing the provider’s text', async () => {
    const servers = await start({
      tracker: { type: 'remote', url: provider.url },
    })
    const url = await servers.signIn('tracker', '/')
    const params = new URLSearchParams({
      state: url!.searchParams.get('state')!,
      error: 'access_denied',
      error_description: 'Visit evil.example',
    })
    await servers.finishSignIn(params)
    expect(status(servers)).toMatchObject({
      state: 'failed',
      error: 'Sign-in was cancelled or refused',
    })
  })

  it('leaves servers with their own Authorization header alone', async () => {
    const servers = await start({
      tracker: {
        type: 'remote',
        url: provider.url,
        headers: { Authorization: 'Bearer wrong' },
      },
    })
    expect(status(servers)).toMatchObject({ state: 'failed', signedIn: null })
    await expect(servers.signIn('tracker', '/')).rejects.toThrow(
      /doesn’t use sign-in/,
    )
  })
})
