import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { documentKind } from '../../shared/documents.ts'
import {
  IGNORED_FOLDERS,
  keepsFolderFile,
  MAX_FOLDER_FILES,
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
   * background.
   * @throws if the project has no folder, or it can't be read
   */
  sync(projectId: string): FolderSync {
    const folder = this.#projects.get(projectId)?.folder
    if (!folder) throw new Error('This project has no folder')
    const found = new Map<string, { size: number; mtime: number }>()
    let skipped = walk(folder, '', found)
    const known = new Map(
      this.#projects.syncedFiles(projectId).map((f) => [f.name, f]),
    )
    const result: FolderSync = { added: 0, updated: 0, removed: 0, skipped: 0 }
    for (const [name, file] of known) {
      if (found.has(name)) continue
      this.#projects.removeFile(projectId, file.fileId)
      result.removed++
    }
    for (const [name, now] of found) {
      const file = known.get(name)
      if (!file) {
        // A file added by hand under this name keeps it.
        if (this.#projects.fileNamed(projectId, name)) {
          skipped++
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
    }
    result.skipped = skipped
    return result
  }
}

/**
 * Collects the files under `dir` that projects take into `found`, by their
 * path from the folder; returns how many it passed over. Links are not
 * followed, so the folder is all that is read.
 */
function walk(
  root: string,
  path: string,
  found: Map<string, { size: number; mtime: number }>,
): number {
  let skipped = 0
  let entries
  try {
    entries = readdirSync(join(root, path), { withFileTypes: true })
  } catch (err) {
    // The folder itself must be readable; one inside it (a trash folder, say)
    // may not be.
    if (!path) throw err
    return 1
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1))
  for (const entry of entries) {
    const name = path ? `${path}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!IGNORED_FOLDERS.has(entry.name)) {
        skipped += walk(root, name, found)
      }
    } else if (entry.isFile()) {
      let stat
      try {
        stat = statSync(join(root, name))
      } catch {
        skipped++
        continue
      }
      if (keepsFolderFile(name, stat.size) && found.size < MAX_FOLDER_FILES) {
        found.set(name, { size: stat.size, mtime: Math.floor(stat.mtimeMs) })
      } else skipped++
    }
  }
  return skipped
}
