import { describe, expect, it } from 'vitest'
import { parseMcpConfig } from '../../../src/server/mcp/mcp-config.ts'

const loadMcpConfig = (config: unknown, env: NodeJS.ProcessEnv) =>
  parseMcpConfig(config, env, 'config.json')

describe('the MCP servers of config.json', () => {
  it('reads local and remote servers, filling ${VAR} from the environment', () => {
    const config = {
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
    }
    const env = { NOTES: '/notes', FILES_TOKEN: 'f1', TRACKER_TOKEN: 't1' }
    expect(loadMcpConfig(config, env)).toEqual({
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

  it('fills ${NAME:-default} with the default when NAME is missing, not when it is empty', () => {
    const servers = (env: NodeJS.ProcessEnv) =>
      loadMcpConfig(
        {
          mcpServers: {
            files: {
              type: 'local',
              command: 'npx',
              args: ['${ROOT:-/srv/notes}', 'x${LEVEL:-}y'],
            },
          },
        },
        env,
      ).files
    expect(servers({})).toMatchObject({ args: ['/srv/notes', 'xy'] })
    expect(servers({ ROOT: '/home/me', LEVEL: '2' })).toMatchObject({
      args: ['/home/me', 'x2y'],
    })
    expect(servers({ ROOT: '' })).toMatchObject({ args: ['', 'xy'] })
  })

  it('says what is wrong, naming the server and field', () => {
    expect(() =>
      loadMcpConfig({ mcpServers: { files: { type: 'local' } } }, {}),
    ).toThrow(/files.*command/s)

    expect(() =>
      loadMcpConfig(
        { mcpServers: { web: { type: 'remote', url: 'not a url' } } },
        {},
      ),
    ).toThrow(/web.*url/s)

    expect(() =>
      loadMcpConfig(
        { mcpServers: { x: { type: 'cloud', url: 'http://a' } } },
        {},
      ),
    ).toThrow(/x.*type/s)

    // A typo isn't silently ignored.
    expect(() =>
      loadMcpConfig(
        { mcpServers: { files: { type: 'local', command: 'a', arg: [] } } },
        {},
      ),
    ).toThrow(/arg/)

    // Names become tool-name prefixes.
    expect(() =>
      loadMcpConfig(
        { mcpServers: { 'my files': { type: 'local', command: 'a' } } },
        {},
      ),
    ).toThrow(/my files/)

    expect(() =>
      loadMcpConfig(
        { mcpServers: { files: { type: 'local', command: '${NOPE}' } } },
        {},
      ),
    ).toThrow(/NOPE.*isn’t set.*chibot config set env\.NOPE/)
  })
})
