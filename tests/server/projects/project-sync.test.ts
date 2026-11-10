import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../../src/server/database.ts'
import type { FileStore } from '../../../src/server/file-store.ts'
import {
  ProjectIndex,
  ProjectStore,
  ProjectSync,
} from '../../../src/server/projects/index.ts'
import type { FolderSync, Project } from '../../../src/shared/types.ts'
import { testApp, testFiles } from '../fakes.ts'

describe('a project that mirrors a folder', () => {
  let dir: string
  let files: FileStore
  let projects: ProjectStore
  let index: ProjectIndex
  let sync: ProjectSync
  let project: Project
  let app: ReturnType<typeof testApp>
  const update = vi.fn()
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chibot-folder-'))
    const db = openDatabase(':memory:')
    files = testFiles(db)
    projects = new ProjectStore(db, files)
    index = new ProjectIndex(db, projects, files, null)
    sync = new ProjectSync(projects, files, index)
    project = projects.create('Docs')
    update.mockClear()
    app = testApp({
      files,
      projects,
      index,
      sync,
      watcher: { update } as never,
    })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const put = (name: string, text: string, seconds?: number) => {
    const path = join(dir, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
    if (seconds) utimesSync(path, seconds, seconds)
  }
  const link = (path = dir) => {
    projects.setFolder(project.id, path)
    return sync.sync(project.id)
  }
  // Indexing runs in the background, one file after another.
  const settle = () => index.index('')
  const names = () =>
    projects
      .files(project.id)
      .map((f) => f.name)
      .sort()
  const finds = async (word: string) =>
    (await index.candidates(project.id, word)).keyword.length > 0

  it('brings in the readable files, by their path in the folder', async () => {
    put('intro.md', 'The zebra crossing')
    put('notes/plan.txt', 'Ship the giraffe')
    put('photo.png', 'not a document')
    put('node_modules/dep/readme.md', 'ignored')
    expect(link()).toEqual({
      added: 2,
      updated: 0,
      removed: 0,
      skipped: 1,
      left: [{ path: 'photo.png', why: "a type projects can't read" }],
    })
    await settle()
    expect(names()).toEqual(['intro.md', 'notes/plan.txt'])
    expect(projects.files(project.id).map((f) => f.status)).toEqual([
      'ready',
      'ready',
    ])
    expect(await finds('giraffe')).toBe(true)
  })

  it('indexes only what changed, and drops what was deleted', async () => {
    put('a.md', 'alpha zebra', 1000)
    put('b.md', 'bravo giraffe', 1000)
    link()
    await settle()
    const before = projects.files(project.id)

    put('a.md', 'alpha lion', 2000)
    rmSync(join(dir, 'b.md'))
    put('c.md', 'charlie otter', 2000)
    expect(sync.sync(project.id)).toEqual({
      added: 1,
      updated: 1,
      removed: 1,
      skipped: 0,
      left: [],
    })
    await settle()
    expect(names()).toEqual(['a.md', 'c.md'])
    // The changed file keeps its id; its old text is gone from search.
    expect(projects.files(project.id)[0]!.fileId).toBe(before[0]!.fileId)
    expect(await finds('lion')).toBe(true)
    expect(await finds('zebra')).toBe(false)
    expect(await finds('giraffe')).toBe(false)
  })

  it('does nothing when nothing changed, or only the time did', async () => {
    put('a.md', 'alpha', 1000)
    link()
    await settle()
    expect(sync.sync(project.id)).toEqual({
      added: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      left: [],
    })
    utimesSync(join(dir, 'a.md'), 3000, 3000)
    expect(sync.sync(project.id).updated).toBe(0)
    // The new time is remembered, so the next sync doesn't read it again.
    expect(projects.syncedFiles(project.id)[0]!.mtime).toBe(3_000_000)
  })

  it('leaves files added by hand alone, and a name they hold', async () => {
    const mine = files.save(null, 'a.md', 'text/markdown', Buffer.from('mine'))
    projects.addFile(project.id, mine.id)
    put('a.md', 'from the folder')
    put('b.md', 'bravo')
    expect(link()).toEqual({
      added: 1,
      updated: 0,
      removed: 0,
      skipped: 1,
      left: [{ path: 'a.md', why: 'a file you added has that name' }],
    })
    rmSync(join(dir, 'b.md'))
    sync.sync(project.id)
    expect(names()).toEqual(['a.md'])
    expect(files.read(mine.id).toString()).toBe('mine')
  })

  it('does not follow links out of the folder', () => {
    const outside = mkdtempSync(join(tmpdir(), 'chibot-outside-'))
    try {
      writeFileSync(join(outside, 'secret.md'), 'secret')
      symlinkSync(outside, join(dir, 'linked'))
      symlinkSync(join(outside, 'secret.md'), join(dir, 'secret.md'))
      expect(link().added).toBe(0)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('keeps the files when the folder is unlinked, and stops tracking them', () => {
    put('a.md', 'alpha')
    link()
    projects.setFolder(project.id, null)
    rmSync(join(dir, 'a.md'))
    expect(projects.get(project.id)!.folder).toBeNull()
    expect(projects.syncedFiles(project.id)).toEqual([])
    expect(names()).toEqual(['a.md'])
    expect(() => sync.sync(project.id)).toThrow('no folder')
  })

  it('has routes that link, sync and unlink', async () => {
    const call = async <T>(method: string, path: string, body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return {
        status: res.status,
        body: (await res.json().catch(() => null)) as T,
      }
    }
    const base = `/api/projects/${project.id}`
    put('a.md', 'alpha')
    expect(await call('POST', `${base}/sync`)).toMatchObject({ status: 409 })

    const linked = await call<FolderSync>('PUT', `${base}/folder`, {
      path: dir,
    })
    expect(linked).toMatchObject({ status: 200, body: { added: 1 } })
    expect(projects.get(project.id)!.folder).toBe(dir)
    // Each change of the link or a sync tells the watcher.
    expect(update).toHaveBeenLastCalledWith(project.id)
    expect(update).toHaveBeenCalledTimes(1)

    put('b.md', 'bravo')
    expect((await call<FolderSync>('POST', `${base}/sync`)).body.added).toBe(1)
    expect(update).toHaveBeenCalledTimes(2)

    // Relative paths are ambiguous, and the path must be a folder.
    expect(
      await call('PUT', `${base}/folder`, { path: basename(dir) }),
    ).toMatchObject({ status: 400 })
    expect(
      await call('PUT', `${base}/folder`, { path: join(dir, 'a.md') }),
    ).toMatchObject({ status: 400 })
    expect(
      await call('PUT', `${base}/folder`, { path: join(dir, 'none') }),
    ).toMatchObject({ status: 400 })
    expect(
      await call('PUT', '/api/projects/nope/folder', { path: dir }),
    ).toMatchObject({ status: 404 })

    // Refused links don't reach it.
    expect(update).toHaveBeenCalledTimes(2)

    expect((await call('DELETE', `${base}/folder`)).status).toBe(204)
    expect(projects.get(project.id)!.folder).toBeNull()
    expect(update).toHaveBeenCalledTimes(3)
    expect((await call('DELETE', '/api/projects/nope/folder')).status).toBe(404)
  })

  it('tells the watcher when the project goes', async () => {
    const res = await app.request(`/api/projects/${project.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
    expect(update).toHaveBeenCalledWith(project.id)
  })

  it('reads ~ as the home folder', async () => {
    put('docs/a.md', 'alpha')
    const home = process.env.HOME
    process.env.HOME = dir
    try {
      const res = await app.request(`/api/projects/${project.id}/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '~/docs' }),
      })
      expect(res.status).toBe(200)
      expect(projects.get(project.id)!.folder).toBe(join(dir, 'docs'))
    } finally {
      process.env.HOME = home
    }
  })

  it('passes over a folder it cannot read, and refuses one it cannot open', async () => {
    put('a.md', 'alpha')
    mkdirSync(join(dir, 'locked'))
    put('locked/b.md', 'bravo')
    chmodSync(join(dir, 'locked'), 0o000)
    try {
      expect(link()).toMatchObject({ added: 1, skipped: 1 })
      chmodSync(dir, 0o000)
      const res = await app.request(`/api/projects/${project.id}/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dir }),
      })
      chmodSync(dir, 0o755)
      // The earlier link is still in place.
      expect(res.status).toBe(400)
      expect(projects.get(project.id)!.folder).toBe(dir)
    } finally {
      chmodSync(dir, 0o755)
      chmodSync(join(dir, 'locked'), 0o755)
    }
  })

  // As the owner of the files these tests make can always read them; not so as root.
  const asRoot = process.getuid?.() === 0

  it.skipIf(asRoot)(
    'carries on past a file it cannot read, and says which',
    async () => {
      put('a.md', 'alpha')
      put('locked.md', 'secret')
      put('z.md', 'zulu')
      chmodSync(join(dir, 'locked.md'), 0o000)
      try {
        const result = link()
        // The ones before it and after it are in; it is named, with why.
        expect(result).toMatchObject({ added: 2, skipped: 1 })
        expect(result.left).toEqual([
          { path: 'locked.md', why: "can't be read (EACCES)" },
        ])
        expect(names()).toEqual(['a.md', 'z.md'])
        // It is mended with the next change, nothing else needs it.
        chmodSync(join(dir, 'locked.md'), 0o644)
        expect(sync.sync(project.id)).toMatchObject({ added: 1, skipped: 0 })
        expect(names()).toEqual(['a.md', 'locked.md', 'z.md'])
      } finally {
        chmodSync(join(dir, 'locked.md'), 0o644)
      }
    },
  )

  it.skipIf(asRoot)(
    'keeps what a folder brought in while that folder will not open',
    async () => {
      put('keep.md', 'kept')
      put('sub/inside.md', 'inside')
      link()
      expect(names()).toEqual(['keep.md', 'sub/inside.md'])
      chmodSync(join(dir, 'sub'), 0o000)
      try {
        const result = sync.sync(project.id)
        // Not taken for deleted: it could not be looked at.
        expect(result.removed).toBe(0)
        expect(result.left).toEqual([
          { path: 'sub/', why: "can't be opened (EACCES)" },
        ])
        expect(names()).toEqual(['keep.md', 'sub/inside.md'])
      } finally {
        chmodSync(join(dir, 'sub'), 0o755)
      }
      rmSync(join(dir, 'sub'), { recursive: true })
      expect(sync.sync(project.id).removed).toBe(1)
    },
  )

  it('says why each kind of file was left out', () => {
    put('slides.pptx', 'x')
    put('big.pdf', 'x')
    put('ok.md', 'fine')
    // A file over 50 MB, without making one: only its size matters.
    writeFileSync(join(dir, 'big.pdf'), Buffer.alloc(50 * 1024 * 1024 + 1))
    const { left, added } = link()
    expect(added).toBe(1)
    expect(left).toEqual([
      { path: 'big.pdf', why: 'larger than 50 MB' },
      { path: 'slides.pptx', why: "a type projects can't read" },
    ])
  })

  it('limits the files a folder brings in, not the ones it already has', () => {
    for (let i = 0; i < 1000; i++)
      put(`f${String(i).padStart(4, '0')}.md`, `n${i}`)
    expect(link()).toMatchObject({ added: 1000, skipped: 0 })
    // A file that sorts before all of them is new: left out, the rest kept.
    put('a0.md', 'first in line')
    const result = sync.sync(project.id)
    expect(result).toMatchObject({ added: 0, removed: 0, skipped: 1 })
    expect(result.left).toEqual([
      { path: 'a0.md', why: 'over the limit of 1,000 files' },
    ])
    expect(projects.files(project.id)).toHaveLength(1000)
    // Room made, it comes in.
    rmSync(join(dir, 'f0999.md'))
    expect(sync.sync(project.id)).toMatchObject({ added: 1, removed: 1 })
  }, 30_000)
})
