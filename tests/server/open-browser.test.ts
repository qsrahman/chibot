import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { localOrigin } from '../../src/server/local-origin.ts'
import {
  openBrowser,
  openCommand,
  wantsBrowser,
} from '../../src/server/open-browser.ts'

describe('wantsBrowser', () => {
  const at = (over: Partial<Parameters<typeof wantsBrowser>[0]> = {}) =>
    wantsBrowser({ noOpen: false, tty: true, env: {}, ...over })

  it('opens it for someone at a terminal', () => {
    expect(at()).toBe(true)
  })

  it('stays closed when asked, and where nobody is looking at a screen', () => {
    expect(at({ noOpen: true })).toBe(false)
    expect(at({ tty: false })).toBe(false)
    expect(at({ env: { CI: 'true' } })).toBe(false)
    expect(at({ env: { SSH_CONNECTION: '10.0.0.1 1 10.0.0.2 22' } })).toBe(
      false,
    )
  })
})

describe('localOrigin', () => {
  it('names the address a browser on this machine uses', () => {
    expect(localOrigin({ host: '127.0.0.1', port: 3000 })).toBe(
      'http://127.0.0.1:3000',
    )
    expect(localOrigin({ host: 'localhost', port: 3000 })).toBe(
      'http://localhost:3000',
    )
    expect(localOrigin({ host: '0.0.0.0', port: 80 })).toBe(
      'http://127.0.0.1:80',
    )
    expect(localOrigin({ host: '::', port: 3000 })).toBe(
      'http://127.0.0.1:3000',
    )
    expect(localOrigin({ host: '::1', port: 3000 })).toBe('http://[::1]:3000')
  })
})

describe('openCommand', () => {
  it('uses each system’s own', () => {
    const url = 'http://127.0.0.1:3000'
    expect(openCommand('darwin', url)).toEqual(['open', [url]])
    expect(openCommand('linux', url)).toEqual(['xdg-open', [url]])
    expect(openCommand('win32', url)).toEqual(['cmd', ['/c', 'start', '', url]])
  })
})

describe('openBrowser', () => {
  const fakeChild = () => Object.assign(new EventEmitter(), { unref: vi.fn() })

  it('starts the command apart from chibot, so it does not wait for it', () => {
    const child = fakeChild()
    const run = vi.fn(() => child)
    openBrowser('http://127.0.0.1:3000', {
      platform: 'darwin',
      run: run as never,
    })
    expect(run).toHaveBeenCalledWith('open', ['http://127.0.0.1:3000'], {
      stdio: 'ignore',
      detached: true,
    })
    expect(child.unref).toHaveBeenCalled()
  })

  it('does not fail when there is no browser to start', () => {
    const child = fakeChild()
    openBrowser('http://127.0.0.1:3000', {
      platform: 'linux',
      run: (() => child) as never,
    })
    expect(() =>
      child.emit('error', new Error('spawn xdg-open ENOENT')),
    ).not.toThrow()
  })
})
