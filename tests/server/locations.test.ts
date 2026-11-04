import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { locations } from '../../src/server/locations.ts'

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
    expect(found.legacy).toHaveLength(2)
    expect(found.legacy[0]).toContain(paths.data)
    expect(found.legacy[1]).toContain(join(paths.config, 'mcp.json'))
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
