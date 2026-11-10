import { describe, expect, it } from 'vitest'
import { skipsPath } from '../../../src/shared/folder-files.ts'
import {
  keepFolderFiles,
  MAX_FOLDER_FILES,
  syncNotice,
} from '../../../src/web/projects/folderFiles.ts'

const file = (name: string) => new File(['x'], name)

describe('keepFolderFiles', () => {
  it('keeps what projects read and skips the rest of a folder', () => {
    const { kept, skipped } = keepFolderFiles([
      file('app/src/main.ts'),
      file('app/README'),
      file('app/node_modules/dep/index.js'),
      file('app/.git/config'),
      file('app/dist/bundle.js'),
      file('app/logo.png'),
      file('app/data/rows.csv'),
    ])
    expect(kept.map((f) => f.name)).toEqual([
      'app/src/main.ts',
      'app/README',
      'app/data/rows.csv',
    ])
    expect(skipped).toBe(4)
  })

  it('leaves files picked one by one for the server to judge', () => {
    const { kept, skipped } = keepFolderFiles([file('photo.png'), file('a.md')])
    expect(kept).toHaveLength(2)
    expect(skipped).toBe(0)
  })

  it('stops at a thousand files', () => {
    const many = Array.from({ length: MAX_FOLDER_FILES + 5 }, (_, i) =>
      file(`app/f${i}.md`),
    )
    const { kept, skipped } = keepFolderFiles(many)
    expect(kept).toHaveLength(MAX_FOLDER_FILES)
    expect(skipped).toBe(5)
  })
})

describe('skipping what a folder holds that no one added it for', () => {
  it('skips hidden files and folders, and dependency folders, in an upload', () => {
    const { kept, skipped } = keepFolderFiles([
      file('app/readme.md'),
      file('app/.env.md'),
      file('app/.obsidian/workspace.json'),
      file('app/docs/.drafts/idea.md'),
      file('app/vendor/lib/readme.md'),
      file('app/node_modules/dep/readme.md'),
      file('app/docs/guide.md'),
    ])
    expect(kept.map((f) => f.name)).toEqual([
      'app/readme.md',
      'app/docs/guide.md',
    ])
    expect(skipped).toBe(5)
  })

  it('knows a path that is hidden or in a skipped folder, either way slashes lean', () => {
    for (const path of [
      '.git',
      'a/.hidden/b.md',
      'a\\.obsidian\\x.json',
      'node_modules/x',
      'src/vendor',
      '.DS_Store',
    ]) {
      expect(skipsPath(path), path).toBe(true)
    }
    for (const path of ['a.md', 'docs/guide.md', 'my.notes/a.md', '']) {
      expect(skipsPath(path), path).toBe(false)
    }
  })
})

describe('syncNotice', () => {
  const none = { added: 0, updated: 0, removed: 0, skipped: 0, left: [] }

  it('says what changed, and nothing when nothing did', () => {
    expect(syncNotice(none)).toBeNull()
    expect(syncNotice({ ...none, added: 2, removed: 1 })).toBe(
      'Folder synced: 2 added, 1 removed.',
    )
  })

  it('names what it left out and why, when asked', () => {
    const left = [
      { path: 'slides.pptx', why: "a type projects can't read" },
      { path: 'locked.md', why: "can't be read (EACCES)" },
    ]
    expect(syncNotice({ ...none, skipped: 2, left })).toBe(
      "The folder has not changed. Left out: slides.pptx (a type projects can't read), locked.md (can't be read (EACCES)).",
    )
    expect(syncNotice({ ...none, added: 1, skipped: 12, left })).toBe(
      "Folder synced: 1 added. Left out: slides.pptx (a type projects can't read), locked.md (can't be read (EACCES)), and 10 more.",
    )
    // Not at every opening of the page: only what changed.
    expect(
      syncNotice({ ...none, skipped: 2, left }, { details: false }),
    ).toBeNull()
    expect(
      syncNotice({ ...none, added: 1, skipped: 2, left }, { details: false }),
    ).toBe('Folder synced: 1 added.')
  })
})
