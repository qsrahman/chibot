import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FolderListing } from '../../../src/shared/types.ts'
import { testApp } from '../fakes.ts'

describe('GET /api/folders', () => {
  let dir: string
  let home: string | undefined
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chibot-folders-'))
    home = process.env.HOME
  })
  afterEach(() => {
    process.env.HOME = home
    rmSync(dir, { recursive: true, force: true })
  })

  const list = async (path?: string) => {
    const res = await testApp().request(
      `/api/folders${path === undefined ? '' : `?path=${encodeURIComponent(path)}`}`,
    )
    return {
      status: res.status,
      body: (await res.json()) as FolderListing & { error?: string },
    }
  }
  const put = (path: string, text = 'x') => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }

  it('lists the subfolders, and the files a project can read, by name', async () => {
    for (const name of ['10-ten', '2-two', 'a-first', 'B-second', '.hidden']) {
      mkdirSync(join(dir, name))
    }
    put('notes.md')
    put('data.csv')
    put('photo.png')
    put('.secret.md')
    const { status, body } = await list(dir)
    expect(status).toBe(200)
    expect(body.path).toBe(dir)
    expect(body.parent).toBe(dirname(dir))
    // By name as people count; no hidden ones.
    expect(body.folders.map((f) => f.name)).toEqual([
      '2-two',
      '10-ten',
      'a-first',
      'B-second',
    ])
    expect(body.folders[0]!.path).toBe(join(dir, '2-two'))
    expect(body.files).toEqual(['data.csv', 'notes.md'])
    expect(body.more).toBe(0)
  })

  it('takes a link for what it points to, and a broken one for nothing', async () => {
    mkdirSync(join(dir, 'real'))
    put('doc.md')
    symlinkSync(join(dir, 'real'), join(dir, 'to-real'))
    symlinkSync(join(dir, 'doc.md'), join(dir, 'to-doc.md'))
    symlinkSync(join(dir, 'missing'), join(dir, 'to-nothing'))
    const { body } = await list(dir)
    expect(body.folders.map((f) => f.name)).toEqual(['real', 'to-real'])
    expect(body.files).toEqual(['doc.md', 'to-doc.md'])
  })

  it('starts at the home folder, and reads ~ as it', async () => {
    mkdirSync(join(dir, 'projects'))
    process.env.HOME = dir
    expect((await list()).body).toMatchObject({ path: dir, home: dir })
    expect((await list('~/projects')).body.path).toBe(join(dir, 'projects'))
    expect((await list('   ')).body.path).toBe(dir)
  })

  it('has no folder above the top', async () => {
    const { status, body } = await list('/')
    expect(status).toBe(200)
    expect(body.parent).toBeNull()
  })

  it('says what is wrong with a path', async () => {
    put('file.md')
    const nope = await list('docs/here')
    expect(nope).toMatchObject({ status: 400 })
    expect(nope.body.error).toMatch(/full path/)
    expect((await list('~lisa')).status).toBe(400)
    const file = await list(join(dir, 'file.md'))
    expect(file.status).toBe(400)
    expect(file.body.error).toMatch(/not a folder/)
    expect((await list(join(dir, 'gone'))).status).toBe(400)
    mkdirSync(join(dir, 'locked'))
    chmodSync(join(dir, 'locked'), 0o000)
    try {
      expect((await list(join(dir, 'locked'))).status).toBe(400)
    } finally {
      chmodSync(join(dir, 'locked'), 0o755)
    }
  })

  it('cuts a huge folder, and says how much it left out', async () => {
    for (let i = 0; i < 510; i++) mkdirSync(join(dir, `d${i}`))
    const { body } = await list(dir)
    expect(body.folders).toHaveLength(500)
    expect(body.more).toBe(10)
  })
})
