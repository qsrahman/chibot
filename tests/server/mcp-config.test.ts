import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadMcpConfig } from '../../src/server/mcp-config.ts'

describe('mcp.json', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chibot-mcp-'))
    path = join(dir, 'mcp.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const write = (config: unknown) => writeFileSync(path, JSON.stringify(config))

  it('is optional', () => {
    expect(loadMcpConfig(path, {})).toEqual({})
  })

  it('reads local and remote servers, filling ${VAR} from the environment', () => {
    write({
      mcpServers: {
        files: {
          type: 'local',
          command: 'npx',
          args: ['-y', 'server-files', '${NOTES}'],
          env: { TOKEN: '${FILES_TOKEN}' },
        },
        tracker: {
          type: 'remote',
          url: 'http://localhost:8808/mcp',
          headers: { Authorization: 'Bearer ${TRACKER_TOKEN}' },
        },
      },
    })
    const env = { NOTES: '/notes', FILES_TOKEN: 'f1', TRACKER_TOKEN: 't1' }
    expect(loadMcpConfig(path, env)).toEqual({
      files: {
        type: 'local',
        command: 'npx',
        args: ['-y', 'server-files', '/notes'],
        env: { TOKEN: 'f1' },
      },
      tracker: {
        type: 'remote',
        url: 'http://localhost:8808/mcp',
        headers: { Authorization: 'Bearer t1' },
      },
    })
  })

  it('says what is wrong, naming the server and field', () => {
    write({ mcpServers: { files: { type: 'local' } } })
    expect(() => loadMcpConfig(path, {})).toThrow(/files.*command/s)

    write({ mcpServers: { web: { type: 'remote', url: 'not a url' } } })
    expect(() => loadMcpConfig(path, {})).toThrow(/web.*url/s)

    write({ mcpServers: { x: { type: 'cloud', url: 'http://a' } } })
    expect(() => loadMcpConfig(path, {})).toThrow(/x.*type/s)

    // A typo isn't silently ignored.
    write({ mcpServers: { files: { type: 'local', command: 'a', arg: [] } } })
    expect(() => loadMcpConfig(path, {})).toThrow(/arg/)

    // Names become tool-name prefixes.
    write({ mcpServers: { 'my files': { type: 'local', command: 'a' } } })
    expect(() => loadMcpConfig(path, {})).toThrow(/my files/)

    write({ mcpServers: { files: { type: 'local', command: '${NOPE}' } } })
    expect(() => loadMcpConfig(path, {})).toThrow(/NOPE.*isn’t set/)

    writeFileSync(path, '{ not json')
    expect(() => loadMcpConfig(path, {})).toThrow(/mcp\.json/)
  })
})
