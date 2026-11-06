import { describe, expect, it } from 'vitest'
import { McpServerFile, McpServers } from '../../../src/server/mcp/index.ts'
import { testApp } from '../fakes.ts'

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
})
