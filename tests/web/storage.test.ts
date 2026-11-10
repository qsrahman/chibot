import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStored, writeStored } from '../../src/web/ui/storage.ts'

afterEach(() => vi.unstubAllGlobals())

describe('stored preferences', () => {
  it('keeps, reads and forgets a value', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    })
    writeStored('k', 'v')
    expect(readStored('k')).toBe('v')
    writeStored('k', null)
    expect(readStored('k')).toBeNull()
  })

  it('carries on when storage throws (blocked site data)', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    vi.stubGlobal('localStorage', {
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
    })
    expect(readStored('k')).toBeNull()
    expect(() => writeStored('k', 'v')).not.toThrow()
    expect(() => writeStored('k', null)).not.toThrow()
  })
})
