import { realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '../../src/server/mcp-config.ts'
import { McpServers } from '../../src/server/mcp-servers.ts'

// The fixture server, as a real child process over stdio.
const fixture: McpServerConfig = {
  type: 'local',
  command: process.execPath,
  args: [join(import.meta.dirname, '../fixtures/mcp-server.ts')],
}

describe('MCP servers', () => {
  let servers: McpServers
  afterEach(() => servers.close())

  const start = async (
    configs: Record<string, McpServerConfig>,
    disabled: string[] = [],
  ) => {
    servers = new McpServers(configs, { disabled: () => disabled })
    await servers.start()
    return servers
  }
  const status = (name: string) =>
    servers.statuses().find((s) => s.name === name)!

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

  it('leaves switched-off servers alone, and syncs with the switch', async () => {
    const disabled = ['fixture']
    await start({ fixture }, disabled)
    expect(status('fixture').state).toBe('disabled')

    disabled.length = 0
    await servers.sync()
    expect(status('fixture').state).toBe('connected')
    const pid = servers.pid('fixture')!
    expect(() => process.kill(pid, 0)).not.toThrow()

    disabled.push('fixture')
    await servers.sync()
    expect(status('fixture').state).toBe('disabled')
    // Its process stopped.
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
  })

  it('cancels a call when the answer is stopped', async () => {
    await start({ fixture })
    const stop = new AbortController()
    const call = servers.callTool('fixture__slow', {}, stop.signal)
    setTimeout(() => stop.abort(), 100)
    const started = Date.now()
    await expect(call).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(5000)
  })
})
