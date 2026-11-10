import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { skipsPath } from '../../shared/folder-files.ts'
import type { ProjectSync } from './project-sync.ts'
import type { ProjectStore } from './project-store.ts'
import { errorMessage } from '../../shared/errors.ts'

/** What `FolderWatcher` needs of `fs.watch` (tests pass their own). */
export type Watch = (
  folder: string,
  listener: (filename: string | null) => void,
) => Pick<FSWatcher, 'close' | 'on'>

const watchFolder: Watch = (folder, listener) => {
  const watcher = fsWatch(folder, { recursive: true }, (_, filename) =>
    listener(filename),
  )
  // A watcher alone doesn't keep chibot running.
  watcher.unref()
  return watcher
}

// Editors and builds write in several steps: wait until a folder is quiet.
const QUIET_MS = 1500

/**
 * Keeps mirrored projects up to date while chibot runs: when something in a
 * project's folder changes it runs the project's sync, which only reads what
 * changed. It watches for "something changed" and leaves what to the sync, so
 * it never handles a file itself. Where watching isn't possible (a network
 * drive, a very large tree on Linux) nothing breaks: the project still syncs
 * when its page opens and on Sync now.
 */
export class FolderWatcher {
  readonly #projects: ProjectStore
  readonly #sync: ProjectSync
  readonly #watch: Watch
  readonly #quietMs: number
  readonly #watching = new Map<
    string,
    { folder: string; watcher: Pick<FSWatcher, 'close' | 'on'> }
  >()
  readonly #timers = new Map<string, NodeJS.Timeout>()

  constructor(
    projects: ProjectStore,
    sync: ProjectSync,
    { watch = watchFolder, quietMs = QUIET_MS } = {},
  ) {
    this.#projects = projects
    this.#sync = sync
    this.#watch = watch
    this.#quietMs = quietMs
  }

  /** At startup: watches, and catches up with changes made while chibot was off. */
  startAll(): void {
    for (const { id, folder } of this.#projects.list()) {
      if (!folder) continue
      this.update(id)
      this.#run(id)
    }
  }

  /**
   * Makes the watching match the project: a folder now watches it (again, if
   * it was another), none, or no such project, stops. Call it after the
   * project's folder or the project itself changed.
   */
  update(projectId: string): void {
    const folder = this.#projects.get(projectId)?.folder ?? null
    const current = this.#watching.get(projectId)
    if (current?.folder === folder) return
    this.stop(projectId)
    if (!folder) return
    try {
      const watcher = this.#watch(folder, (filename) => {
        if (!filename || skipsPath(filename)) return
        this.#later(projectId)
      })
      // The folder went away, or the system ran out of watches.
      watcher.on('error', (err) => {
        console.error(`Watching ${folder} stopped:`, err.message)
        this.stop(projectId)
      })
      this.#watching.set(projectId, { folder, watcher })
    } catch (err) {
      console.error(`Can't watch ${folder}:`, errorMessage(err))
    }
  }

  stop(projectId: string): void {
    this.#watching.get(projectId)?.watcher.close()
    this.#watching.delete(projectId)
    clearTimeout(this.#timers.get(projectId))
    this.#timers.delete(projectId)
  }

  close(): void {
    for (const id of [...this.#watching.keys()]) this.stop(id)
  }

  #later(projectId: string) {
    clearTimeout(this.#timers.get(projectId))
    const timer = setTimeout(() => this.#run(projectId), this.#quietMs)
    timer.unref()
    this.#timers.set(projectId, timer)
  }

  #run(projectId: string) {
    this.#timers.delete(projectId)
    try {
      this.#sync.sync(projectId)
    } catch (err) {
      // Most likely the folder is gone (a drive unmounted): stop; Sync now tries again.
      console.error(`Syncing the folder failed:`, errorMessage(err))
      this.stop(projectId)
    }
  }
}
