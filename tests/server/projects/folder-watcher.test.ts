import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../../src/server/database.ts'
import {
  FolderWatcher,
  ProjectIndex,
  ProjectStore,
  ProjectSync,
} from '../../../src/server/projects/index.ts'
import { testFiles } from '../fakes.ts'

/** A stand-in for fs.watch: remembers who watches what, and lets a test make events. */
function fakeWatch() {
  const open = new Map<string, (filename: string | null) => void>()
  const closed: string[] = []
  const errors = new Map<string, (err: Error) => void>()
  const watch = (
    folder: string,
    listener: (filename: string | null) => void,
  ) => {
    open.set(folder, listener)
    const watcher = {
      close: () => {
        open.delete(folder)
        closed.push(folder)
      },
      on: (event: string, handler: (err: Error) => void) => {
        if (event === 'error') errors.set(folder, handler)
        return watcher
      },
    }
    return watcher as never
  }
  return { watch, open, closed, errors }
}

describe('FolderWatcher', () => {
  let dir: string
  let projects: ProjectStore
  let sync: ProjectSync
  let syncs: ReturnType<typeof vi.spyOn>
  let project: string
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    dir = mkdtempSync(join(tmpdir(), 'chibot-watch-'))
    const db = openDatabase(':memory:')
    const files = testFiles(db)
    projects = new ProjectStore(db, files)
    sync = new ProjectSync(
      projects,
      files,
      new ProjectIndex(db, projects, files, null),
    )
    syncs = vi.spyOn(sync, 'sync')
    project = projects.create('P').id
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  const link = (folder = dir) => projects.setFolder(project, folder)

  it('syncs once, after a folder has been quiet, however many changes there were', () => {
    const w = fakeWatch()
    const watcher = new FolderWatcher(projects, sync, {
      watch: w.watch,
      quietMs: 1000,
    })
    link()
    watcher.update(project)
    for (const name of ['a.md', 'b.md', 'c.md']) {
      w.open.get(dir)!(name)
      vi.advanceTimersByTime(400)
    }
    expect(syncs).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(syncs).toHaveBeenCalledOnce()
  })

  it('does not hear of folders a sync skips, or of changes with no name', () => {
    const w = fakeWatch()
    const watcher = new FolderWatcher(projects, sync, {
      watch: w.watch,
      quietMs: 10,
    })
    link()
    watcher.update(project)
    for (const name of [
      'node_modules/x/index.md',
      'src/.git/HEAD',
      '.obsidian/workspace.json',
      '.DS_Store',
      'vendor/lib/readme.md',
      null,
    ]) {
      w.open.get(dir)!(name)
    }
    vi.advanceTimersByTime(100)
    expect(syncs).not.toHaveBeenCalled()
    w.open.get(dir)!('docs/new.md')
    vi.advanceTimersByTime(100)
    expect(syncs).toHaveBeenCalledOnce()
  })

  it('follows the project: another folder, none, or the project gone', () => {
    const w = fakeWatch()
    const watcher = new FolderWatcher(projects, sync, { watch: w.watch })
    const other = join(dir, 'other')
    mkdirSync(other)
    link()
    watcher.update(project)
    watcher.update(project) // already watching it: nothing to do
    expect([...w.open.keys()]).toEqual([dir])
    link(other)
    watcher.update(project)
    expect([...w.open.keys()]).toEqual([other])
    projects.setFolder(project, null)
    watcher.update(project)
    expect(w.open.size).toBe(0)
    link()
    watcher.update(project)
    projects.delete(project)
    watcher.update(project)
    expect(w.open.size).toBe(0)
  })

  it('forgets a change that was waiting when watching stops', () => {
    const w = fakeWatch()
    const watcher = new FolderWatcher(projects, sync, {
      watch: w.watch,
      quietMs: 100,
    })
    link()
    watcher.update(project)
    w.open.get(dir)!('a.md')
    projects.setFolder(project, null)
    watcher.update(project)
    vi.advanceTimersByTime(1000)
    expect(syncs).not.toHaveBeenCalled()
  })

  it('stops when the watcher fails, and starts again when asked to', () => {
    const w = fakeWatch()
    const watcher = new FolderWatcher(projects, sync, { watch: w.watch })
    link()
    watcher.update(project)
    w.errors.get(dir)!(new Error('ENOSPC'))
    expect(w.open.size).toBe(0)
    watcher.update(project)
    expect(w.open.size).toBe(1)
  })

  it('stops, and says so, when the folder can’t be synced any more', () => {
    const w = fakeWatch()
    const watcher = new FolderWatcher(projects, sync, {
      watch: w.watch,
      quietMs: 10,
    })
    link()
    watcher.update(project)
    rmSync(dir, { recursive: true })
    w.open.get(dir)!('a.md')
    vi.advanceTimersByTime(100)
    expect(console.error).toHaveBeenCalled()
    expect(w.open.size).toBe(0)
  })

  it.skipIf(process.getuid?.() === 0)(
    'keeps watching past a file it cannot read',
    () => {
      const w = fakeWatch()
      const watcher = new FolderWatcher(projects, sync, {
        watch: w.watch,
        quietMs: 10,
      })
      writeFileSync(join(dir, 'a.md'), 'alpha')
      writeFileSync(join(dir, 'locked.md'), 'secret')
      chmodSync(join(dir, 'locked.md'), 0o000)
      try {
        link()
        watcher.update(project)
        w.open.get(dir)!('a.md')
        vi.advanceTimersByTime(100)
        // The file that can't be read is reported by the sync; the watching goes on.
        expect(syncs).toHaveBeenCalledOnce()
        expect(w.open.size).toBe(1)
        expect(projects.files(project).map((f) => f.name)).toEqual(['a.md'])
      } finally {
        chmodSync(join(dir, 'locked.md'), 0o644)
      }
    },
  )

  it('carries on without watching where the system can’t', () => {
    const watcher = new FolderWatcher(projects, sync, {
      watch: () => {
        throw new Error('not supported here')
      },
    })
    link()
    expect(() => watcher.update(project)).not.toThrow()
    expect(console.error).toHaveBeenCalled()
  })

  it('at startup watches every mirrored project and catches up with it', () => {
    writeFileSync(join(dir, 'while-off.md'), 'written while chibot was off')
    const w = fakeWatch()
    const plain = projects.create('No folder').id
    link()
    new FolderWatcher(projects, sync, { watch: w.watch }).startAll()
    expect([...w.open.keys()]).toEqual([dir])
    expect(syncs).toHaveBeenCalledOnce()
    expect(projects.files(project).map((f) => f.name)).toEqual(['while-off.md'])
    expect(projects.files(plain)).toEqual([])
  })

  it('close stops them all', () => {
    const w = fakeWatch()
    const watcher = new FolderWatcher(projects, sync, { watch: w.watch })
    link()
    watcher.update(project)
    watcher.close()
    expect(w.open.size).toBe(0)
  })
})

// The real fs.watch: events differ by system, so this is the one test of that.
describe('FolderWatcher on a real folder', () => {
  it('brings in a file written to the folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chibot-watch-'))
    const db = openDatabase(':memory:')
    const files = testFiles(db)
    const projects = new ProjectStore(db, files)
    const sync = new ProjectSync(
      projects,
      files,
      new ProjectIndex(db, projects, files, null),
    )
    const project = projects.create('P').id
    projects.setFolder(project, dir)
    const watcher = new FolderWatcher(projects, sync, { quietMs: 50 })
    try {
      watcher.update(project)
      // A system may start watching a moment after fs.watch returns, and a
      // change before that is never reported: keep changing the folder until
      // one is heard.
      let n = 0
      await vi.waitFor(
        () => {
          writeFileSync(
            join(dir, `later-${n++}.md`),
            'arrived after the watch began',
          )
          expect(projects.files(project).length).toBeGreaterThan(0)
        },
        { timeout: 20_000, interval: 250 },
      )
      expect(projects.files(project)[0]!.name).toMatch(/^later-\d+\.md$/)
    } finally {
      watcher.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
