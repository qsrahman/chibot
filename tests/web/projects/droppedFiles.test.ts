import { describe, expect, it } from 'vitest'
import { droppedFiles } from '../../../src/web/projects/folders.ts'

const file = new File(['x'], 'drop.md')

/** A drop whose one item has an entry that fails when it is read. */
const unreadable = (isDirectory: boolean) => {
  const fail = (_: unknown, reject: (error: Error) => void) =>
    reject(new Error('NotFoundError'))
  const entry = {
    isDirectory,
    isFile: !isDirectory,
    name: 'drop.md',
    file: fail,
    createReader: () => ({ readEntries: fail }),
  }
  return {
    items: [{ webkitGetAsEntry: () => entry }],
    files: [file],
  } as unknown as DataTransfer
}

describe('droppedFiles', () => {
  it('takes the plain files when a file entry cannot be read', async () => {
    expect(await droppedFiles(unreadable(false))).toEqual([file])
  })

  it('fails for a folder it cannot read, rather than adding something else', async () => {
    await expect(droppedFiles(unreadable(true))).rejects.toThrow(
      'NotFoundError',
    )
  })
})
