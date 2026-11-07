import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readBuildId } from '../../src/server/build-id.ts'

describe('readBuildId', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true })))
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), 'chibot-build-'))
    dirs.push(d)
    return d
  }

  it('reads the id the build wrote', () => {
    const d = dir()
    writeFileSync(join(d, 'build-id.txt'), 'abc123\n')
    expect(readBuildId(d)).toBe('abc123')
  })

  it('is null when there is no build, or the file is empty', () => {
    expect(readBuildId(join(dir(), 'missing'))).toBeNull()
    const d = dir()
    writeFileSync(join(d, 'build-id.txt'), ' \n')
    expect(readBuildId(d)).toBeNull()
  })
})
