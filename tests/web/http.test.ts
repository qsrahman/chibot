import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiFetch,
  asNetworkError,
  OFFLINE,
  request,
} from '../../src/web/http.ts'

afterEach(() => vi.unstubAllGlobals())

describe('a connection that fails', () => {
  it('says chibot can’t be reached, not "Failed to fetch"', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.reject(new TypeError('Failed to fetch')),
    )
    await expect(apiFetch('/api/x')).rejects.toThrow(OFFLINE)
    await expect(request('/api/x')).rejects.toThrow(OFFLINE)
  })

  it('leaves aborts and other errors as they were', () => {
    const abort = new DOMException('stopped', 'AbortError')
    expect(asNetworkError(abort)).toBe(abort)
    const other = new Error('boom')
    expect(asNetworkError(other)).toBe(other)
  })

  it('still reports the server’s own error', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'No such chat' }, { status: 404 }),
    )
    await expect(request('/api/x')).rejects.toThrow('No such chat')
  })
})
