import { describe, expect, it } from 'vitest'
import { keepFolderFiles, MAX_FOLDER_FILES } from '../../src/web/folderFiles.ts'

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
