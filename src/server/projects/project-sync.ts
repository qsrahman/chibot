import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { documentKind } from '../../shared/documents.ts'
import {
  IGNORED_FOLDERS,
  isHidden,
  MAX_FOLDER_FILES,
  whyLeftOut,
} from '../../shared/folder-files.ts'
import type { FolderSync } from '../../shared/types.ts'
import type { FileStore } from '../file-store.ts'
import type { ProjectIndex } from './project-index.ts'
import type { ProjectStore } from './project-store.ts'

/**
 * Makes a project's files match its folder: adds new files, replaces changed
 * ones and removes deleted ones, indexing only what changed. Files added by
 * hand are left alone.
 */
export class ProjectSync {
  readonly #projects: ProjectStore
  readonly #files: FileStore
  readonly #index: ProjectIndex

  constructor(projects: ProjectStore, files: FileStore, index: ProjectIndex) {
    this.#projects = projects
    this.#files = files
    this.#index = index
  }

  /**
   * Synchronous, so two syncs never interleave; indexing carries on in the
   * background. One file that can't be read doesn't stop the rest: it is
   * reported with why, and a file already in the project stays as it was.
   * @throws if the project has no folder, or the folder can't be read
   */
  sync(projectId: string): FolderSync {
    const folder = this.#projects.get(projectId)?.folder
    if (!folder) throw new Error('This project has no folder')
    const { found, left, unsure } = scan(folder)
    const known = new Map(
      this.#projects.syncedFiles(projectId).map((f) => [f.name, f]),
    )
    const result: FolderSync = {
      added: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      left: [],
    }
    for (const [name, file] of known) {
      if (found.has(name)) continue
      // Not found because it couldn't be looked at (a folder that wouldn't
      // open) is not gone: it stays until it can be seen.
      if (
        unsure.some(
          (p) => name === p || (p.endsWith('/') && name.startsWith(p)),
        )
      ) {
        continue
      }
      this.#projects.removeFile(projectId, file.fileId)
      result.removed++
    }
    // The limit is on how many files a folder brings in: a file that was
    // already in keeps its place, and only new ones are left out past it.
    let tracked = known.size - result.removed
    for (const [name, now] of found) {
      const file = known.get(name)
      try {
        if (!file) {
          // A file added by hand under this name keeps it.
          if (this.#projects.fileNamed(projectId, name)) {
            left.push({ path: name, why: 'a file you added has that name' })
            continue
          }
          if (tracked >= MAX_FOLDER_FILES) {
            left.push({
              path: name,
              why: `over the limit of ${MAX_FOLDER_FILES.toLocaleString('en')} files`,
            })
            continue
          }
          const bytes = readFileSync(join(folder, name))
          const stored = this.#files.save(
            null,
            name,
            documentKind(name)!.mime,
            bytes,
          )
          this.#projects.addFile(projectId, stored.id, now.mtime)
          void this.#index.index(stored.id)
          tracked++
          result.added++
        } else if (file.size !== now.size || file.mtime !== now.mtime) {
          const bytes = readFileSync(join(folder, name))
          this.#projects.setMtime(file.fileId, now.mtime)
          // Touched but not edited: nothing to index again.
          if (bytes.equals(this.#files.read(file.fileId))) continue
          this.#files.replace(file.fileId, bytes)
          this.#projects.setStatus(file.fileId, 'indexing')
          void this.#index.index(file.fileId)
          result.updated++
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        left.push({
          path: name,
          why: `can't be read (${code ?? (err as Error).message})`,
        })
      }
    }
    result.skipped = left.length
    result.left = left.slice(0, MAX_REPORTED)
    return result
  }
}

// How many of the files left out a sync names (the rest are counted).
const MAX_REPORTED = 8

/**
 * The files under `root` that projects take, by their path from the folder,
 * and those they don't with why. Links are not followed, so the folder is all
 * that is read; a folder inside it that can't be opened is reported, not fatal.
 *
 * `unsure` holds what couldn't be looked at: a file, or a folder with a `/`
 * after it, so a file below it that is already in the project is not taken
 * for deleted.
 *
 * @throws if `root` itself can't be read
 */
function scan(root: string): {
  found: Map<string, { size: number; mtime: number }>
  left: { path: string; why: string }[]
  unsure: string[]
} {
  const found = new Map<string, { size: number; mtime: number }>()
  const left: { path: string; why: string }[] = []
  const unsure: string[] = []
  const walk = (path: string) => {
    let entries
    try {
      entries = readdirSync(join(root, path), { withFileTypes: true })
    } catch (err) {
      if (!path) throw err
      const code = (err as NodeJS.ErrnoException).code ?? 'no access'
      left.push({ path: `${path}/`, why: `can't be opened (${code})` })
      unsure.push(`${path}/`)
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const entry of entries) {
      // Hidden files and folders (.git, .obsidian, .env, .DS_Store) are never
      // listed, taken or named: they are not what a person adds a folder for.
      if (isHidden(entry.name)) continue
      const name = path ? `${path}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!IGNORED_FOLDERS.has(entry.name)) walk(name)
      } else if (entry.isSymbolicLink()) {
        // A link may lead anywhere, so it is not followed (nor a folder's).
        left.push({ path: name, why: 'a link (links are not followed)' })
      } else if (entry.isFile()) {
        let stat
        try {
          stat = statSync(join(root, name))
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code ?? 'no access'
          left.push({ path: name, why: `can't be read (${code})` })
          unsure.push(name)
          continue
        }
        const why = whyLeftOut(name, stat.size)
        if (why) left.push({ path: name, why })
        else
          found.set(name, { size: stat.size, mtime: Math.floor(stat.mtimeMs) })
      }
    }
  }
  walk('')
  return { found, left, unsure }
}
