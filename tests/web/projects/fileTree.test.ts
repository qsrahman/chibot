import { describe, expect, it } from 'vitest'
import { fileTree, folderPaths } from '../../../src/web/projects/fileTree.ts'
import type { ProjectFile } from '../../../src/shared/types.ts'

const file = (
  name: string,
  status: ProjectFile['status'] = 'ready',
): ProjectFile => ({
  fileId: name,
  name,
  mime: 'text/markdown',
  size: 1,
  status,
  error: null,
})

describe('fileTree', () => {
  it('leaves a list without folders as it is', () => {
    const tree = fileTree([file('b.md'), file('a.md')])
    expect(tree.folders).toEqual([])
    expect(tree.files.map((f) => f.label)).toEqual(['a.md', 'b.md'])
  })

  it('groups files by the folders in their names', () => {
    const tree = fileTree([
      file('notes.md'),
      file('docs/intro.md'),
      file('docs/guide/setup.md'),
      file('docs/guide/usage.md'),
      file('src/main.ts'),
    ])
    expect(tree.files.map((f) => f.label)).toEqual(['notes.md'])
    expect(tree.folders.map((f) => f.label)).toEqual(['docs', 'src'])
    const docs = tree.folders[0]!
    expect(docs.files.map((f) => f.label)).toEqual(['intro.md'])
    expect(docs.folders.map((f) => [f.path, f.label])).toEqual([
      ['docs/guide', 'guide'],
    ])
    expect(docs.folders[0]!.files.map((f) => f.label)).toEqual([
      'setup.md',
      'usage.md',
    ])
    expect(folderPaths(tree)).toEqual(['docs', 'docs/guide', 'src'])
  })

  it('joins a folder that holds only another folder with it', () => {
    const tree = fileTree([
      file('src/server/projects/a.ts'),
      file('src/server/projects/b.ts'),
      file('src/web/c.ts'),
    ])
    const [src] = tree.folders
    // src holds server and web, so it stays; server holds only projects.
    expect(src!.label).toBe('src')
    expect(src!.folders.map((f) => [f.label, f.path])).toEqual([
      ['server/projects', 'src/server/projects'],
      ['web', 'src/web'],
    ])
  })

  it('counts the files below a folder, and those failed or still being indexed', () => {
    const tree = fileTree([
      file('a/one.md', 'failed'),
      file('a/b/two.md', 'indexing'),
      file('a/b/three.md'),
      file('a/b/four.md', 'indexing'),
    ])
    expect(tree.folders).toHaveLength(1)
    const a = tree.folders[0]!
    expect(a).toMatchObject({ total: 4, failed: 1, indexing: 2 })
    expect(a.folders[0]).toMatchObject({ total: 3, failed: 0, indexing: 2 })
  })

  it('sorts by name the way people count, folders apart from files', () => {
    const tree = fileTree([
      file('part10/x.md'),
      file('part2/x.md'),
      file('Part1/x.md'),
      file('z.md'),
    ])
    expect(tree.folders.map((f) => f.label)).toEqual([
      'Part1',
      'part2',
      'part10',
    ])
  })

  it('keeps a folder and a file of the same name apart, and ignores stray slashes', () => {
    const tree = fileTree([file('a'), file('a/b.md'), file('/c//d.md')])
    expect(tree.files.map((f) => f.label)).toEqual(['a'])
    expect(tree.folders.map((f) => f.label)).toEqual(['a', 'c'])
    expect(tree.folders[1]!.files.map((f) => f.label)).toEqual(['d.md'])
  })
})
