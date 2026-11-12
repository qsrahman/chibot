import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { locations, openFolders, xdgPaths } from '../../src/server/locations.ts'

const paths = {
  config: '/home/u/.config/chibot',
  data: '/home/u/.local/share/chibot',
}
const where = (env = {}) => locations(env, { paths })

describe('locations', () => {
  it('uses the platform’s folders, and no MCP file, unless told otherwise', () => {
    expect(where()).toEqual({
      configDir: paths.config,
      dataDir: paths.data,
      mcpConfigPath: null,
    })
  })

  it('lets each be set in the environment', () => {
    expect(
      where({
        CHIBOT_CONFIG_DIR: 'a',
        CHIBOT_DATA_DIR: 'b',
        CHIBOT_MCP_CONFIG: 'c/m.json',
      }),
    ).toEqual({
      configDir: resolve('a'),
      dataDir: resolve('b'),
      mcpConfigPath: resolve('c/m.json'),
    })
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
