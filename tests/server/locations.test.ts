import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { locations, openFolders, xdgPaths } from '../../src/server/locations.ts'

const paths = {
  config: '/home/u/.config/chibot',
  data: '/home/u/.local/share/chibot',
}
const root = '/repo'
const where = (files: string[], env = {}) =>
  locations(env, { paths, root, exists: (p) => files.includes(p) })

describe('locations', () => {
  it('uses the platform’s folders on a fresh install', () => {
    expect(where([])).toEqual({
      configDir: paths.config,
      dataDir: paths.data,
      mcpConfigPath: join(paths.config, 'mcp.json'),
      mcpConfigExplicit: false,
      legacy: [],
    })
  })

  it('lets each be set in the environment', () => {
    expect(
      where([], {
        CHIBOT_CONFIG_DIR: 'a',
        CHIBOT_DATA_DIR: 'b',
        CHIBOT_MCP_CONFIG: 'c/m.json',
      }),
    ).toMatchObject({
      configDir: resolve('a'),
      dataDir: resolve('b'),
      mcpConfigPath: resolve('c/m.json'),
    })
    // The MCP file follows the config folder unless named.
    expect(where([], { CHIBOT_CONFIG_DIR: 'a' }).mcpConfigPath).toBe(
      join(resolve('a'), 'mcp.json'),
    )
  })

  it('keeps using a checkout’s data and mcp.json until the new places hold something', () => {
    const found = where(['/repo/data/chibot.db', '/repo/mcp.json'])
    expect(found.dataDir).toBe('/repo/data')
    expect(found.mcpConfigPath).toBe('/repo/mcp.json')
    // It says so, and where to move them.
    // (The MCP file is mentioned at startup only if no config.json replaces it.)
    expect(found.legacy).toHaveLength(1)
    expect(found.legacy[0]).toContain(paths.data)
  })

  it('prefers the standard places once they have been used', () => {
    const found = where([
      '/repo/data/chibot.db',
      '/repo/mcp.json',
      join(paths.data, 'chibot.db'),
      join(paths.config, 'mcp.json'),
    ])
    expect(found.dataDir).toBe(paths.data)
    expect(found.mcpConfigPath).toBe(join(paths.config, 'mcp.json'))
    expect(found.legacy).toEqual([])
  })

  it('never falls back when a place is named', () => {
    const found = where(['/repo/data/chibot.db', '/repo/mcp.json'], {
      CHIBOT_DATA_DIR: 'd',
      CHIBOT_MCP_CONFIG: 'm.json',
    })
    expect(found.dataDir).toBe(resolve('d'))
    expect(found.mcpConfigPath).toBe(resolve('m.json'))
    expect(found.legacy).toEqual([])
  })
})

describe('xdgPaths', () => {
  it('are ~/.config and ~/.local/share, as on Linux, also on a Mac', () => {
    expect(xdgPaths('/Users/u', {})).toEqual({
      config: '/Users/u/.config/chibot',
      data: '/Users/u/.local/share/chibot',
    })
  })

  it('follow XDG_CONFIG_HOME and XDG_DATA_HOME', () => {
    expect(
      xdgPaths('/Users/u', { XDG_CONFIG_HOME: '/c', XDG_DATA_HOME: '/d' }),
    ).toEqual({ config: '/c/chibot', data: '/d/chibot' })
    // An empty one counts as unset, as the specification says.
    expect(xdgPaths('/h', { XDG_CONFIG_HOME: '' }).config).toBe(
      '/h/.config/chibot',
    )
  })
})

describe('openFolders', () => {
  it('lists the folders others can open, and skips missing ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chibot-open-'))
    try {
      const closed = join(dir, 'closed')
      const open = join(dir, 'open')
      mkdirSync(closed, { mode: 0o700 })
      mkdirSync(open)
      chmodSync(open, 0o755)
      expect(openFolders([closed, open, join(dir, 'missing')])).toEqual([open])
    } finally {
      rmSync(dir, { recursive: true })
    }
  })
})
