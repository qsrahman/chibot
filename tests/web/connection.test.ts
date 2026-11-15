import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isGatewayFailure,
  isUnreachable,
  reconnectDelay,
} from '../../src/web/ui/connection.ts'
import { apiFetch } from '../../src/web/http.ts'

afterEach(() => vi.unstubAllGlobals())

describe('isGatewayFailure', () => {
  it('is a proxy’s 502, 503 or 504', () => {
    expect(isGatewayFailure(502, 'text/html')).toBe(true)
    expect(isGatewayFailure(503, null)).toBe(true)
    expect(isGatewayFailure(504, 'text/plain')).toBe(true)
  })

  it('is not chibot’s own JSON error, nor an ordinary failure', () => {
    expect(isGatewayFailure(502, 'application/json; charset=UTF-8')).toBe(false)
    expect(isGatewayFailure(500, null)).toBe(false)
    expect(isGatewayFailure(404, 'text/html')).toBe(false)
    expect(isGatewayFailure(200, 'text/html')).toBe(false)
  })
})

describe('reconnectDelay', () => {
  it('starts at 2 s and grows to 15 s', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 20].map(reconnectDelay)
    expect(delays[0]).toBe(2000)
    expect(delays).toEqual([...delays].sort((a, b) => a - b))
    expect(delays.at(-1)).toBe(15_000)
  })
})

describe('apiFetch', () => {
  it('notes a lost connection, and that chibot answered again', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed')))
    await expect(apiFetch('/api/x')).rejects.toThrow()
    expect(isUnreachable()).toBe(true)

    vi.stubGlobal('fetch', async () => Response.json({ ok: true }))
    await apiFetch('/api/x')
    expect(isUnreachable()).toBe(false)
  })

  it('counts a proxy’s gateway error, but not chibot’s own error', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('Bad gateway', { status: 502 }),
    )
    await apiFetch('/api/x')
    expect(isUnreachable()).toBe(true)

    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'The model failed' }, { status: 502 }),
    )
    await apiFetch('/api/x')
    expect(isUnreachable()).toBe(false)
  })

  it('ignores an abort', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.reject(new DOMException('stopped', 'AbortError')),
    )
    await expect(apiFetch('/api/x')).rejects.toThrow()
    expect(isUnreachable()).toBe(false)
  })
})
