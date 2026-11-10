import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { documentKind } from '../../shared/documents.ts'
import type { FolderListing } from '../../shared/types.ts'

// A folder with more than this is cut, so one huge folder can't fill a menu.
const MAX_FOLDERS = 500
const MAX_FILES = 100

/**
 * `requested` as the absolute path of a folder on this machine (`~` is the
 * home folder), or `null` when it names no place in particular (`docs`, `~lisa`).
 */
export function absolutePath(requested: string): string | null {
  const expanded =
    requested === '~' || requested.startsWith('~/')
      ? join(homedir(), requested.slice(1))
      : requested
  return isAbsolute(expanded) ? resolve(expanded) : null
}

/**
 * What is in a folder, for choosing one to mirror: its subfolders and the
 * files a project can read (the rest, and anything hidden, are left out).
 *
 * @throws Error saying why when it is not a folder or can't be read
 */
export function listFolder(path: string): FolderListing {
  if (!statSync(path).isDirectory()) throw new Error('it is not a folder')
  const folders: { name: string; path: string }[] = []
  const files: string[] = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const here = join(path, entry.name)
    // A link counts as what it points to (and one that leads nowhere as nothing).
    const stat = entry.isSymbolicLink()
      ? statSync(here, { throwIfNoEntry: false })
      : entry
    if (stat?.isDirectory()) folders.push({ name: entry.name, path: here })
    else if (stat?.isFile() && documentKind(entry.name)) files.push(entry.name)
  }
  const byName = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true })
  folders.sort((a, b) => byName(a.name, b.name))
  files.sort(byName)
  const parent = dirname(path)
  return {
    path,
    parent: parent === path ? null : parent,
    home: homedir(),
    folders: folders.slice(0, MAX_FOLDERS),
    files: files.slice(0, MAX_FILES),
    more:
      Math.max(0, folders.length - MAX_FOLDERS) +
      Math.max(0, files.length - MAX_FILES),
  }
}
