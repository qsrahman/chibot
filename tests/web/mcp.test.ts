import { describe, expect, it } from 'vitest'
import type { McpServerStatus } from '../../src/shared/types.ts'
import {
  describeMcpServer,
  isConnecting,
  withMember,
} from '../../src/web/mcp.ts'

const server = (patch: Partial<McpServerStatus> = {}): McpServerStatus => ({
  name: 'files',
  type: 'local',
  state: 'connected',
  error: null,
  signedIn: null,
  tools: [],
  ...patch,
})
const tool = (name: string) => ({ name, title: name, description: '' })

describe('describeMcpServer', () => {
  it('says what kind of server it is', () => {
    expect(describeMcpServer(server()).kind).toBe('Local server')
    expect(describeMcpServer(server({ type: 'remote' })).kind).toBe(
      'Remote server',
    )
  })

  it('counts the tools of a connected server', () => {
    expect(describeMcpServer(server()).status).toBe('Connected · 0 tools')
    expect(describeMcpServer(server({ tools: [tool('a')] })).status).toBe(
      'Connected · 1 tool',
    )
    expect(
      describeMcpServer(server({ tools: [tool('a'), tool('b')] })).status,
    ).toBe('Connected · 2 tools')
  })

  it('shows why a server failed, or just that it did', () => {
    expect(
      describeMcpServer(server({ state: 'failed', error: 'spawn ENOENT' }))
        .status,
    ).toBe('Failed: spawn ENOENT')
    expect(describeMcpServer(server({ state: 'failed' })).status).toBe('Failed')
  })

  it('names the other states', () => {
    const status = (state: McpServerStatus['state']) =>
      describeMcpServer(server({ state })).status
    expect(status('disabled')).toBe('Off')
    expect(status('connecting')).toBe('Connecting…')
    expect(status('needs-sign-in')).toBe('Needs sign-in')
  })
})

describe('isConnecting', () => {
  it('is true while any server is still connecting', () => {
    expect(isConnecting(undefined)).toBe(false)
    expect(isConnecting([])).toBe(false)
    expect(isConnecting([server(), server({ state: 'failed' })])).toBe(false)
    expect(isConnecting([server(), server({ state: 'connecting' })])).toBe(true)
  })
})

describe('withMember', () => {
  it('adds a name once and removes it', () => {
    expect(withMember(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(withMember(['a', 'b'], 'b', true)).toEqual(['a', 'b'])
    expect(withMember(['a', 'b'], 'a', false)).toEqual(['b'])
    expect(withMember(['a'], 'x', false)).toEqual(['a'])
  })

  it('leaves the list it was given alone', () => {
    const list = ['a']
    withMember(list, 'b', true)
    expect(list).toEqual(['a'])
  })
})
