import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Config } from '../../src/server/config.ts'
import {
  configFileSchema,
  readConfigFile,
  readMcpServers,
  redacted,
  withSetting,
  writeConfigFile,
} from '../../src/server/config-file.ts'
import { offerMcpImport, type Prompts } from '../../src/server/init.ts'
import { loadMcpServers } from '../../src/server/mcp/index.ts'

const local = { type: 'local', command: 'node', args: ['server.js'] }

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

  it('beat a standalone mcp.json, unless that file is named', () => {
    const path = join(dir, 'config', 'mcp.json')
    writeConfigFile(join(dir, 'config'), { mcpServers: { inline: local } })
    writeFileSync(path, JSON.stringify({ mcpServers: { filed: local } }))
    expect(Object.keys(loadMcpServers(config()))).toEqual(['inline'])
    // Naming a file (CHIBOT_MCP_CONFIG) is a decision, so it is used.
    expect(
      Object.keys(loadMcpServers(config({ CHIBOT_MCP_CONFIG: path }))),
    ).toEqual(['filed'])
  })

  it('fall back to the standalone file, and to none', () => {
    // (Named, since an unnamed one would find a checkout's own mcp.json.)
    expect(
      loadMcpServers(config({ CHIBOT_MCP_CONFIG: join(dir, 'none.json') })),
    ).toEqual({})
    writeConfigFile(join(dir, 'config'), { chat: { model: 'm' } })
    writeFileSync(
      join(dir, 'config', 'mcp.json'),
      JSON.stringify({ mcpServers: { filed: local } }),
    )
    expect(Object.keys(loadMcpServers(config()))).toEqual(['filed'])
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

  it('can be read out of an old mcp.json', () => {
    const path = join(dir, 'old.json')
    writeFileSync(path, JSON.stringify({ mcpServers: { a: local } }))
    expect(readMcpServers(path)).toEqual({ a: local })
    expect(readMcpServers(join(dir, 'missing.json'))).toBeNull()
    writeFileSync(path, '{ nope')
    expect(readMcpServers(path)).toBeNull()
    writeFileSync(path, JSON.stringify({ mcpServers: [] }))
    expect(readMcpServers(path)).toBeNull()
  })
})

describe('chibot init and an old mcp.json', () => {
  const prompts = (answer: string) => {
    const asked: string[] = []
    const said: string[] = []
    const p: Prompts = {
      async ask(question) {
        asked.push(question)
        return answer
      },
      say: (m) => void said.push(m),
    }
    return { p, asked, said }
  }
  const servers = { files: local, web: local }

  it('offers to move the servers in, saying which, and what to do about ${NAME}', async () => {
    const { p, asked, said } = prompts('')
    const next = await offerMcpImport(
      p,
      { chat: { model: 'm' } },
      '/x/mcp.json',
      servers,
    )
    expect(next).toEqual({ chat: { model: 'm' }, mcpServers: servers })
    expect(asked[0]).toContain('/x/mcp.json')
    expect(asked[0]).toContain('files, web')
    expect(said.join('')).toContain('config set env.NAME')
  })

  it('leaves everything alone when declined, empty, or already there', async () => {
    const file = { chat: { model: 'm' } }
    expect(await offerMcpImport(prompts('n').p, file, '/x', servers)).toBe(file)
    const none = prompts('')
    expect(await offerMcpImport(none.p, file, '/x', null)).toBe(file)
    expect(await offerMcpImport(none.p, file, '/x', {})).toBe(file)
    const has = { mcpServers: { other: local } }
    expect(await offerMcpImport(none.p, has, '/x', servers)).toBe(has)
    expect(none.asked).toEqual([])
  })
})
