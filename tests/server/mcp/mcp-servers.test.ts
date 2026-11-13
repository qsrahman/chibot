import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '../../../src/server/mcp/mcp-config.ts'
import { McpServers } from '../../../src/server/mcp/mcp-servers.ts'

// The fixture server, as a real child process over stdio.
const fixture: McpServerConfig = {
  type: 'local',
  command: process.execPath,
  args: [join(import.meta.dirname, '../../fixtures/mcp-server.ts')],
}

describe('MCP servers', () => {
  let servers: McpServers
  afterEach(() => servers.close())

  const start = async (configs: Record<string, McpServerConfig>) => {
    servers = new McpServers(configs)
    await servers.start()
    return servers
  }
  const status = (name: string) =>
    servers.statuses().find((s) => s.name === name)!

  it('reloads mcp.json: new servers connect, removed ones stop, changed ones restart', async () => {
    let file: Record<string, McpServerConfig> = { fixture }
    servers = new McpServers(file, {
      load: () => file,
    })
    await servers.start()
    const pid = servers.pid('fixture')!

    // Untouched servers aren't restarted.
    file = { fixture, other: fixture }
    await servers.reload()
    expect(servers.pid('fixture')).toBe(pid)
    expect(status('other').state).toBe('connected')
    const otherPid = servers.pid('other')!

    // A changed one restarts (its name is its identity); removed ones stop.
    file = { other: { ...fixture, env: { CHANGED: '1' } } }
    await servers.reload()
    expect(servers.statuses().map((s) => s.name)).toEqual(['other'])
    expect(servers.pid('other')).not.toBe(otherPid)
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
    expect(servers.tools().map((t) => t.name)).toContain('other__echo')
    expect(servers.tools().map((t) => t.name)).not.toContain('fixture__echo')
  })

  it('keeps everything as it was when the file is invalid', async () => {
    let broken = false
    servers = new McpServers(
      { fixture },
      {
        load: () => {
          if (broken) throw new Error('mcp.json: bad')
          return { fixture }
        },
      },
    )
    await servers.start()
    broken = true
    await expect(servers.reload()).rejects.toThrow('mcp.json: bad')
    expect(status('fixture').state).toBe('connected')
  })

  it('has nothing to reload without a loader', async () => {
    await start({ fixture })
    await expect(servers.reload()).rejects.toThrow(/no config/)
  })

  it('connects and lists each server’s tools, prefixed by its name', async () => {
    await start({ fixture })
    expect(status('fixture')).toMatchObject({
      type: 'local',
      state: 'connected',
      error: null,
    })
    expect(status('fixture').tools.map((t) => t.name)).toEqual([
      'fixture__echo',
      'fixture__slow',
      'fixture__picture',
      'fixture__fail',
      'fixture__progress',
      'fixture__crash',
      'fixture__grow',
    ])
    expect(status('fixture').tools[0]).toMatchObject({ title: 'Echo' })

    const result = await servers.callTool('fixture__echo', { text: 'hi' })
    expect(result.content).toEqual([{ type: 'text', text: 'echo: hi' }])
  })

  it('reports a server that can’t start, without stopping the others', async () => {
    await start({
      fixture,
      broken: { type: 'local', command: 'chibot-no-such-command' },
    })
    expect(status('fixture').state).toBe('connected')
    expect(status('broken')).toMatchObject({ state: 'failed', tools: [] })
    expect(status('broken').error).toMatch(/ENOENT|not found|spawn/i)
  })

  it('starts local servers in the home folder unless they set cwd', async () => {
    // Prints where it runs, then fails, so it shows as the error.
    const where = (cwd?: string): McpServerConfig => ({
      type: 'local',
      command: process.execPath,
      args: ['-e', 'console.error(process.cwd()); process.exit(1)'],
      cwd,
    })
    await start({ home: where(), tmp: where(realpathSync(tmpdir())) })
    expect(status('home').error).toBe(homedir())
    expect(status('tmp').error).toBe(realpathSync(tmpdir()))
  })

  it('notices a crash, and reconnects on request', async () => {
    await start({ fixture })
    await expect(servers.callTool('fixture__crash', {})).rejects.toThrow()
    await vi.waitFor(() => expect(status('fixture').state).toBe('failed'))
    expect(servers.tools()).toEqual([])

    await servers.connect('fixture')
    expect(status('fixture').state).toBe('connected')
  })

  it('follows a server’s changed tool list', async () => {
    await start({ fixture })
    await servers.callTool('fixture__grow', {})
    await vi.waitFor(() =>
      expect(status('fixture').tools.map((t) => t.name)).toContain(
        'fixture__extra',
      ),
    )
  })

  it('leaves switched-off servers alone, and follows the switch on reload', async () => {
    let current: Record<string, McpServerConfig> = {
      fixture: { ...fixture, enabled: false },
    }
    servers = new McpServers(current, { load: () => current })
    await servers.start()
    expect(status('fixture').state).toBe('disabled')

    current = { fixture }
    await servers.reload()
    expect(status('fixture').state).toBe('connected')
    const pid = servers.pid('fixture')!
    expect(() => process.kill(pid, 0)).not.toThrow()

    current = { fixture: { ...fixture, enabled: false } }
    await servers.reload()
    expect(status('fixture').state).toBe('disabled')
    // Its process stopped.
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
  })

  describe('timeouts, per server', () => {
    const only = (patch: Partial<McpServerConfig>) =>
      ({ ...fixture, ...patch }) as McpServerConfig

    it('give a call that says nothing for its tool timeout up', async () => {
      await start({ fixture: only({ toolTimeoutSec: 1 }) })
      const started = Date.now()
      await expect(servers.callTool('fixture__slow', {})).rejects.toThrow(
        /timed out/i,
      )
      expect(Date.now() - started).toBeLessThan(5000)
    })

    it('start the timeout again when a call reports progress', async () => {
      // 1.5 s of work, with a report every 0.3 s: longer than the 1 s timeout.
      await start({ fixture: only({ toolTimeoutSec: 1 }) })
      const result = await servers.callTool('fixture__progress', {})
      expect(result.content).toEqual([{ type: 'text', text: 'finished' }])
    })

    it('give a server that never answers its startup timeout', async () => {
      await start({
        silent: {
          type: 'local',
          command: process.execPath,
          args: ['-e', 'setTimeout(() => {}, 60000)'],
          startupTimeoutSec: 1,
        },
      })
      expect(status('silent').state).toBe('failed')
      expect(status('silent').error).toMatch(/timed out/i)
    })

    it('are not a change of connection', async () => {
      let current: Record<string, McpServerConfig> = { fixture }
      servers = new McpServers(current, { load: () => current })
      await servers.start()
      const pid = servers.pid('fixture')
      current = { fixture: only({ toolTimeoutSec: 5, startupTimeoutSec: 5 }) }
      await servers.reload()
      expect(servers.pid('fixture')).toBe(pid)
    })
  })

  describe('switches in the server’s own entry', () => {
    const only = (patch: Partial<McpServerConfig>) =>
      ({ ...fixture, ...patch }) as McpServerConfig

    it('keeps a server, and its place in the list, when it is switched off and on', async () => {
      let current: Record<string, McpServerConfig> = { fixture, other: fixture }
      servers = new McpServers(current, {
        load: () => current,
      })
      await servers.start()
      current = { fixture: only({ enabled: false }), other: fixture }
      await servers.reload()
      expect(status('fixture').state).toBe('disabled')
      current = { fixture: only({ enabled: true }), other: fixture }
      await servers.reload()
      expect(servers.statuses().map((s) => s.name)).toEqual([
        'fixture',
        'other',
      ])
    })

    it('switch a server off', async () => {
      await start({ fixture: only({ enabled: false }) })
      expect(status('fixture').state).toBe('disabled')
      await servers.close()
      // On unless `enabled` is false.
      await start({ fixture: only({ enabled: true }), other: fixture })
      expect(status('fixture').state).toBe('connected')
      expect(status('other').state).toBe('connected')
    })

    it('say whether calls ask first', async () => {
      servers = new McpServers({
        fixture: only({ ask: true }),
        other: only({ ask: false }),
        third: fixture,
      })
      expect(servers.asks('fixture')).toBe(true)
      expect(servers.asks('other')).toBe(false)
      expect(servers.asks('third')).toBe(false)
      expect(servers.asks('nobody')).toBe(false)
      expect(servers.statuses().find((s) => s.name === 'fixture')!.ask).toBe(
        true,
      )
    })

    it('switch tools off, by the server’s name for them', async () => {
      await start({ fixture: only({ disabledTools: ['echo'] }) })
      const enabled = Object.fromEntries(
        status('fixture').tools.map((t) => [t.name, t.enabled]),
      )
      expect(enabled).toMatchObject({
        fixture__echo: false,
        fixture__slow: true,
        fixture__picture: true,
      })
      expect(servers.toolOff('fixture__echo')).toBe(true)
      expect(servers.toolOff('fixture__fail')).toBe(false)
      expect(servers.toolOff('not-a-tool')).toBe(false)
    })

    it('apply on reload without reconnecting what stays on', async () => {
      let current: Record<string, McpServerConfig> = { fixture }
      servers = new McpServers({ fixture }, { load: () => current })
      await servers.start()
      const pid = servers.pid('fixture')!

      current = { fixture: only({ ask: true, disabledTools: ['echo'] }) }
      await servers.reload()
      expect(servers.pid('fixture')).toBe(pid)
      expect(servers.asks('fixture')).toBe(true)
      expect(servers.toolOff('fixture__echo')).toBe(true)

      current = { fixture: only({ enabled: false }) }
      await servers.reload()
      expect(status('fixture').state).toBe('disabled')
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())

      // A change that is not a switch restarts it, as before.
      current = { fixture: only({ args: [...(fixture.args ?? []), '--x'] }) }
      await servers.reload()
      expect(status('fixture').state).toBe('connected')
    })
  })

  it('cancels a call when the answer is stopped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chibot-slow-'))
    const started = join(dir, 'started')
    try {
      await start({
        fixture: { ...fixture, env: { CHIBOT_SLOW_MARKER: started } },
      })
      const stop = new AbortController()
      const call = expect(
        servers.callTool('fixture__slow', {}, stop.signal),
      ).rejects.toThrow()
      // Cancel once the server has the call, rather than on a timer that may
      // fire before it starts.
      await vi.waitFor(() => expect(existsSync(started)).toBe(true))
      stop.abort()
      await call
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
