import { describe, expect, it } from 'vitest'
import {
  McpServerFile,
  McpServers,
  parseMcpConfig,
} from '../../../src/server/mcp/index.ts'
import { testApp, testSettings } from '../fakes.ts'

function setup(
  initial: Record<string, unknown> = {},
  locked: string | null = null,
) {
  let servers = initial
  const file = new McpServerFile({
    source: 'config.json',
    locked,
    read: () => structuredClone(servers),
    write: (next) => {
      servers = next
    },
    check: (next) => {
      if ('bad' in next) throw new Error('config.json: bad is broken')
    },
  })
  return { file, saved: () => servers }
}

const remote = {
  type: 'remote',
  url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer secret-token' },
} as const

describe('McpServerFile', () => {
  it('describes servers without their secret values', () => {
    const { file } = setup({
      tracker: remote,
      files: { type: 'local', command: 'npx', env: { KEY: 'sekret' } },
    })
    const described = file.describe()
    expect(described).toMatchObject({ editable: true, source: 'config.json' })
    expect(described.servers.tracker).toEqual({
      ...remote,
      headers: { Authorization: '' },
    })
    expect(JSON.stringify(described)).not.toMatch(/secret|sekret/)
  })

  it('adds a server, and keeps a secret left blank when changing it', () => {
    const { file, saved } = setup({ tracker: remote })
    file.put('files', { type: 'local', command: 'npx', env: { KEY: 'new' } })
    file.put('tracker', {
      ...remote,
      url: 'https://example.com/other',
      headers: { Authorization: '', 'X-More': 'more' },
    })
    expect(saved()).toEqual({
      files: { type: 'local', command: 'npx', env: { KEY: 'new' } },
      tracker: {
        type: 'remote',
        url: 'https://example.com/other',
        headers: { Authorization: 'Bearer secret-token', 'X-More': 'more' },
      },
    })
  })

  it('refuses a blank secret that has nothing to keep, and a broken file', () => {
    const { file, saved } = setup()
    expect(() =>
      file.put('files', { type: 'local', command: 'npx', env: { KEY: '' } }),
    ).toThrow('Environment variable KEY needs a value')
    expect(() => file.put('bad', { type: 'local', command: 'npx' })).toThrow(
      'bad is broken',
    )
    expect(() =>
      file.put('has space', { type: 'local', command: 'x' }),
    ).toThrow()
    expect(saved()).toEqual({})
  })

  it('removes a server, and leaves ones it cannot edit alone', () => {
    const { file, saved } = setup({ tracker: remote, odd: { nonsense: true } })
    expect(Object.keys(file.describe().servers)).toEqual(['tracker'])
    file.put('other', { type: 'local', command: 'x' })
    file.remove('tracker')
    expect(Object.keys(saved())).toEqual(['odd', 'other'])
    expect(() => file.remove('tracker')).toThrow('No MCP server')
  })

  it('changes nothing while locked', () => {
    const { file, saved } = setup({ tracker: remote }, 'Set CHIBOT_TOKEN.')
    expect(file.describe()).toMatchObject({
      editable: false,
      reason: 'Set CHIBOT_TOKEN.',
    })
    expect(() => file.put('x', { type: 'local', command: 'x' })).toThrow(
      'Set CHIBOT_TOKEN.',
    )
    expect(() => file.remove('tracker')).toThrow('Set CHIBOT_TOKEN.')
    expect(Object.keys(saved())).toEqual(['tracker'])
  })
})

describe('McpServerFile switches', () => {
  const entry = { type: 'local', command: 'npx' } as const

  it('write off, asking and tools off into the entry, and leave out the defaults', () => {
    const { file, saved } = setup({ files: entry, other: entry })
    file.setSwitch('files', { enabled: false })
    file.setSwitch('files', { ask: true })
    file.setSwitch('files', { tool: { name: 'write_file', enabled: false } })
    file.setSwitch('files', { tool: { name: 'edit_file', enabled: false } })
    expect(saved()).toEqual({
      files: {
        ...entry,
        enabled: false,
        ask: true,
        disabledTools: ['write_file', 'edit_file'],
      },
      other: entry,
    })
    // Back to the defaults: the keys go, so the file holds only what differs.
    file.setSwitch('files', { enabled: true, ask: false })
    file.setSwitch('files', { tool: { name: 'write_file', enabled: true } })
    file.setSwitch('files', { tool: { name: 'edit_file', enabled: true } })
    expect(saved()).toEqual({ files: entry, other: entry })
  })

  it('turn the older `disabled` into `enabled` when a switch is written', () => {
    const { file, saved } = setup({ files: { ...entry, disabled: true } })
    file.setSwitch('files', { ask: true })
    // Untouched until the on/off switch is used.
    expect(saved()).toEqual({ files: { ...entry, disabled: true, ask: true } })
    file.setSwitch('files', { enabled: false })
    expect(saved()).toEqual({ files: { ...entry, enabled: false, ask: true } })
    file.setSwitch('files', { enabled: true })
    expect(saved()).toEqual({ files: { ...entry, ask: true } })
  })

  it('refuse a server that is not there, without touching another’s trouble', () => {
    const { file, saved } = setup({ files: entry, odd: { nonsense: true } })
    expect(() => file.setSwitch('nope', { enabled: false })).toThrow(
      'No MCP server named nope',
    )
    // The entry that is wrong stays as it was; this one can still be switched.
    file.setSwitch('files', { ask: true })
    expect(saved()).toEqual({
      files: { ...entry, ask: true },
      odd: { nonsense: true },
    })
    expect(() => file.setSwitch('odd', { enabled: false })).toThrow()
  })

  it('work while adding servers is locked, and survive editing the server', () => {
    const { file, saved } = setup({ files: entry }, 'Set CHIBOT_TOKEN.')
    file.setSwitch('files', { enabled: false })
    expect(saved()).toEqual({ files: { ...entry, enabled: false } })

    const open = setup({
      files: { ...entry, enabled: false, ask: true, disabledTools: ['x'] },
    })
    open.file.put('files', { type: 'local', command: 'node' })
    // The form can't show the switches, so an edit keeps them.
    expect(open.saved()).toEqual({
      files: {
        type: 'local',
        command: 'node',
        enabled: false,
        ask: true,
        disabledTools: ['x'],
      },
    })
    expect(open.file.describe().servers.files).toMatchObject({
      enabled: false,
      ask: true,
    })
  })
})

describe('MCP routes for editing', () => {
  it('serves the definitions, saves a server and removes it', async () => {
    const { file, saved } = setup()
    const mcp = new McpServers({}, { disabled: () => [], load: () => ({}) })
    const app = testApp({ mcp, mcpFile: file })
    const send = (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

    const defs = await send('GET', '/api/mcp/definitions')
    expect(await defs.json()).toMatchObject({ editable: true, servers: {} })

    const put = await send('PUT', '/api/mcp/servers/files', {
      type: 'local',
      command: 'npx',
    })
    expect(put.status).toBe(200)
    expect(Object.keys(saved())).toEqual(['files'])

    const invalid = await send('PUT', '/api/mcp/servers/files', {
      type: 'remote',
      url: 'ftp://nope',
    })
    expect(invalid.status).toBe(400)

    const gone = await send('DELETE', '/api/mcp/servers/files')
    expect(gone.status).toBe(200)
    expect(saved()).toEqual({})
    expect((await send('DELETE', '/api/mcp/servers/files')).status).toBe(400)
  })

  it('PATCH writes a switch to the file, applies it, and forgets the older setting', async () => {
    const { file, saved } = setup({
      files: { type: 'local', command: process.execPath, args: ['-e', ''] },
    })
    const settings = testSettings('m', {
      disabledMcpServers: ['files'],
      askMcpServers: ['files', 'keep'],
      disabledTools: ['files__echo', 'memory'],
    })
    const mcp = new McpServers(
      {},
      {
        disabled: () => [],
        load: () => parseMcpConfig({ mcpServers: saved() }, {}, 'test'),
      },
    )
    const app = testApp({ mcp, mcpFile: file, settings })
    const patch = (body: unknown) =>
      app.request('/api/mcp/servers/files', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    expect((await patch({ ask: true })).status).toBe(200)
    expect((await patch({ enabled: true })).status).toBe(200)
    expect(
      (await patch({ tool: { name: 'echo', enabled: false } })).status,
    ).toBe(200)
    expect(saved().files).toMatchObject({ ask: true, disabledTools: ['echo'] })
    expect(saved().files).not.toHaveProperty('enabled')
    // What the file now says is no longer in the settings; the rest stays.
    expect(settings.get()).toMatchObject({
      disabledMcpServers: [],
      askMcpServers: ['keep'],
      disabledTools: ['memory'],
    })

    expect((await patch({ tool: { name: '', enabled: true } })).status).toBe(
      400,
    )
    const missing = await app.request('/api/mcp/nope', { method: 'PATCH' })
    expect(missing.status).toBeGreaterThanOrEqual(400)
    await mcp.close()
  })
})
