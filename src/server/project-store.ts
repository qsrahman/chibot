import type { DatabaseSync } from 'node:sqlite'
import type { Project, ProjectFile } from '../shared/types.ts'
import { transaction } from './database.ts'
import type { FileStore } from './file-store.ts'

// Rows as `Project` objects.
const PROJECT =
  'id, name, instructions, created_at AS createdAt, updated_at AS updatedAt'

/**
 * Projects and their files. Chunks and vectors of a file (written by the
 * indexer) are removed here with it.
 */
export class ProjectStore {
  readonly #db: DatabaseSync
  readonly #files: FileStore

  constructor(db: DatabaseSync, files: FileStore) {
    this.#db = db
    this.#files = files
  }

  create(name: string): Project {
    const now = Date.now()
    return this.#db
      .prepare(
        `INSERT INTO projects (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?) RETURNING ${PROJECT}`,
      )
      .get(crypto.randomUUID(), name, now, now) as unknown as Project
  }

  get(id: string): Project | null {
    return (
      (this.#db
        .prepare(`SELECT ${PROJECT} FROM projects WHERE id = ?`)
        .get(id) as Project | undefined) ?? null
    )
  }

  /** Most recently changed first. */
  list(): Project[] {
    return this.#db
      .prepare(`SELECT ${PROJECT} FROM projects ORDER BY updated_at DESC`)
      .all() as unknown as Project[]
  }

  /** Changes what `patch` has; `null` if there's no such project. */
  update(
    id: string,
    { name, instructions }: { name?: string; instructions?: string },
  ): Project | null {
    return (
      (this.#db
        .prepare(
          `UPDATE projects
              SET name = coalesce(?, name),
                  instructions = coalesce(?, instructions),
                  updated_at = ?
            WHERE id = ? RETURNING ${PROJECT}`,
        )
        .get(name ?? null, instructions ?? null, Date.now(), id) as
        Project | undefined) ?? null
    )
  }

  /**
   * Deletes the project and its files. Its chats must be deleted first
   * (they belong to `ConversationStore`).
   */
  delete(id: string): boolean {
    for (const { fileId } of this.files(id)) this.removeFile(id, fileId)
    return (
      Number(
        this.#db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes,
      ) > 0
    )
  }

  files(projectId: string): ProjectFile[] {
    return this.#db
      .prepare(
        `SELECT p.file_id AS fileId, f.name, f.mime, f.size, p.status, p.error
           FROM project_files p JOIN files f ON f.id = p.file_id
          WHERE p.project_id = ?
          ORDER BY p.rowid -- the order they were added
        `,
      )
      .all(projectId) as unknown as ProjectFile[]
  }

  /** Files whose indexing didn't finish (e.g. the server stopped). */
  unfinishedFiles(): { projectId: string; fileId: string }[] {
    return this.#db
      .prepare(
        `SELECT project_id AS projectId, file_id AS fileId
           FROM project_files WHERE status = 'indexing'`,
      )
      .all() as { projectId: string; fileId: string }[]
  }

  /** The project a file is in. */
  projectOf(fileId: string): string | null {
    const row = this.#db
      .prepare('SELECT project_id FROM project_files WHERE file_id = ?')
      .get(fileId) as { project_id: string } | undefined
    return row?.project_id ?? null
  }

  hasFile(fileId: string): boolean {
    return (
      this.#db
        .prepare('SELECT 1 FROM project_files WHERE file_id = ?')
        .get(fileId) !== undefined
    )
  }

  addFile(projectId: string, fileId: string): void {
    this.#db
      .prepare(
        `INSERT INTO project_files (project_id, file_id, status)
         VALUES (?, ?, 'indexing')`,
      )
      .run(projectId, fileId)
    this.#touch(projectId)
  }

  setStatus(
    fileId: string,
    status: ProjectFile['status'],
    error: string | null = null,
  ): void {
    this.#db
      .prepare(
        'UPDATE project_files SET status = ?, error = ? WHERE file_id = ?',
      )
      .run(status, error, fileId)
  }

  /** Removes a file from its project and deletes it, with its chunks. */
  removeFile(projectId: string, fileId: string): boolean {
    let removed = false
    transaction(this.#db, () => {
      removed =
        Number(
          this.#db
            .prepare(
              'DELETE FROM project_files WHERE project_id = ? AND file_id = ?',
            )
            .run(projectId, fileId).changes,
        ) > 0
      if (removed) this.deleteChunks(fileId)
    })
    if (removed) {
      this.#files.delete(fileId)
      this.#touch(projectId)
    }
    return removed
  }

  /** A file's chunks, with their keyword index and vectors. */
  deleteChunks(fileId: string): void {
    const ids = 'SELECT id FROM chunks WHERE file_id = ?'
    this.#db
      .prepare(`DELETE FROM chunks_fts WHERE rowid IN (${ids})`)
      .run(fileId)
    // The vector table exists once something was embedded.
    if (
      this.#db
        .prepare("SELECT 1 FROM sqlite_master WHERE name = 'chunk_vectors'")
        .get()
    ) {
      this.#db
        .prepare(`DELETE FROM chunk_vectors WHERE rowid IN (${ids})`)
        .run(fileId)
    }
    this.#db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId)
  }

  #touch(projectId: string) {
    this.#db
      .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(Date.now(), projectId)
  }
}
