import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Config } from '../../src/server/config.ts'
import {
  configFileSchema,
  readConfigFile,
  redacted,
  withSetting,
  writeConfigFile,
} from '../../src/server/config-file.ts'
import { loadMcpServers } from '../../src/server/mcp/index.ts'

describe('MCP servers in config.json', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chibot-mcpcfg-'))
  })
  afterEach(() => rmSync(dir, { recursive: true }))

  const config = (env: Record<string, string> = {}) =>
    new Config({
      OPENAI_API_KEY: 'k',
      CHIBOT_CONFIG_DIR: join(dir, 'config'),
      CHIBOT_DATA_DIR: join(dir, 'data'),
      ...env,
    })

  it('are read from there, and ${NAME} from the environment, then its env block', () => {
    writeConfigFile(join(dir, 'config'), {
      mcpServers: {
        files: {
          type: 'local',
          command: 'node',
          env: { TOKEN: '${CHIBOT_T_MCP}', OTHER: '${CHIBOT_T_MCP2}' },
        },
      },
      env: { CHIBOT_T_MCP: 'from-file', CHIBOT_T_MCP2: 'from-file' },
    })
    process.env.CHIBOT_T_MCP2 = 'from-env'
    try {
      expect(loadMcpServers(config())).toMatchObject({
        files: { env: { TOKEN: 'from-file', OTHER: 'from-env' } },
      })
    } finally {
      delete process.env.CHIBOT_T_MCP2
    }
  })

  it('are none without a list in config.json', () => {
    expect(loadMcpServers(config())).toEqual({})
    writeConfigFile(join(dir, 'config'), { chat: { model: 'm' } })
    expect(loadMcpServers(config())).toEqual({})
  })

  it('are checked when loaded, so a mistake never stops chibot starting', () => {
    writeConfigFile(join(dir, 'config'), {
      mcpServers: { bad: { type: 'cloud', url: 'x' } },
    })
    // The file itself is fine…
    expect(readConfigFile(join(dir, 'config')).file.mcpServers).toBeDefined()
    // …the servers are the ones reported, naming config.json.
    expect(() => loadMcpServers(config())).toThrow(/config\.json:[\s\S]*bad/)
  })

  it('say which variable is missing, and how to set it', () => {
    writeConfigFile(join(dir, 'config'), {
      mcpServers: { x: { type: 'local', command: '${CHIBOT_T_NOPE}' } },
    })
    expect(() => loadMcpServers(config())).toThrow(
      /config\.json uses \$\{CHIBOT_T_NOPE\}.*config set env\.CHIBOT_T_NOPE/,
    )
  })

  it('show in `config show` by name only, and are edited in the file', () => {
    const file = configFileSchema.parse({
      mcpServers: {
        remote: {
          type: 'remote',
          url: 'https://x',
          headers: { Authorization: 'Bearer SECRET' },
        },
      },
    })
    expect(redacted(file)).toEqual({ mcpServers: { remote: 'set' } })
    expect(JSON.stringify(redacted(file))).not.toContain('SECRET')
    expect(() => withSetting({}, 'mcpServers.files', '{}')).toThrow(
      /edited in config\.json itself/,
    )
  })
})
