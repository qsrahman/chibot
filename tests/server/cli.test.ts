import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../../src/server/cli.ts'

describe('the chibot command', () => {
  let dir: string
  let out: string[]
  let errors: string[]
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chibot-cli-'))
    vi.stubEnv('CHIBOT_CONFIG_DIR', join(dir, 'config'))
    vi.stubEnv('CHIBOT_DATA_DIR', join(dir, 'data'))
    vi.stubEnv('CHIBOT_MCP_CONFIG', '')
    out = []
    errors = []
    vi.spyOn(console, 'log').mockImplementation((m) => void out.push(String(m)))
    vi.spyOn(console, 'error').mockImplementation(
      (m) => void errors.push(String(m)),
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true })
  })

  it('prints its version and its help', async () => {
    await run(['--version'])
    expect(out[0]).toBe(
      (
        JSON.parse(
          readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
        ) as { version: string }
      ).version,
    )
    await run(['--help'])
    expect(out[1]).toContain('chibot init')
    expect(out[1]).toContain('chibot config set')
  })

  it('says where its settings and data live', async () => {
    await run(['config', 'path'])
    expect(out).toEqual([
      expect.stringContaining(join(dir, 'config', 'config.json')),
      expect.stringContaining(join(dir, 'data')),
      expect.stringContaining('mcp.json'),
    ])
  })

  it('still says where the settings are when the file is broken', async () => {
    mkdirSync(join(dir, 'config'), { recursive: true })
    writeFileSync(join(dir, 'config', 'config.json'), '{ nope')
    await run(['config', 'path'])
    expect(out[0]).toContain(join(dir, 'config', 'config.json'))
    // Whatever reads it says what is wrong.
    await expect(run(['config', 'show'])).rejects.toThrow(/isn't valid JSON/)
  })

  it('sets, shows (keys hidden) and removes settings', async () => {
    expect(
      await run(['config', 'set', 'chat.apiKey', 'sk-secret']),
    ).toBeUndefined()
    await run(['config', 'set', 'chat.model', 'm'])
    out.length = 0
    await run(['config', 'show'])
    expect(out[0]).toContain('"model": "m"')
    expect(out[0]).not.toContain('sk-secret')
    await run(['config', 'set', 'chat.model', ''])
    out.length = 0
    await run(['config', 'show'])
    expect(out[0]).not.toContain('"model"')
  })

  it('refuses what it does not know, with a non-zero code', async () => {
    await expect(run(['config', 'set', 'chat.nope', 'x'])).rejects.toThrow(
      /Unknown setting/,
    )
    expect(await run(['config'])).toBe(1)
    expect(await run(['frobnicate'])).toBe(1)
    expect(errors.join('\n')).toContain('Unknown command "frobnicate"')
  })
})
