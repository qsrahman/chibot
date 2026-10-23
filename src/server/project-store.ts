import type { DatabaseSync } from 'node:sqlite'
import type { Project, ProjectFile } from '../shared/types.ts'
import { transaction } from './database.ts'
import type { FileStore } from './file-store.ts'

interface ProjectRow {
  id: string
  name: string
  instructions: string
  created_at: number
  updated_at: number
}

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
    const id = crypto.randomUUID()
    this.#db
      .prepare(
        `INSERT INTO projects (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, name, now, now)
    return this.get(id)!
  }

  get(id: string): Project | null {
    const row = this.#db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as ProjectRow | undefined
    return row ? toProject(row) : null
  }

  /** Most recently changed first. */
  list(): Project[] {
    const rows = this.#db
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
      .all() as unknown as ProjectRow[]
    return rows.map(toProject)
  }

  update(
    id: string,
    patch: { name?: string; instructions?: string },
  ): Project | null {
    const project = this.get(id)
    if (!project) return null
    this.#db
      .prepare(
        'UPDATE projects SET name = ?, instructions = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        patch.name ?? project.name,
        patch.instructions ?? project.instructions,
        Date.now(),
        id,
      )
    return this.get(id)
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
    const ids = this.#db
      .prepare('SELECT id FROM chunks WHERE file_id = ?')
      .all(fileId) as { id: number }[]
    const vectors = this.#db
      .prepare("SELECT 1 FROM sqlite_master WHERE name = 'chunk_vectors'")
      .get()
    for (const { id } of ids) {
      this.#db.prepare('DELETE FROM chunks_fts WHERE rowid = ?').run(id)
      if (vectors) {
        this.#db
          .prepare('DELETE FROM chunk_vectors WHERE rowid = ?')
          .run(BigInt(id))
      }
    }
    this.#db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId)
  }

  #touch(projectId: string) {
    this.#db
      .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(Date.now(), projectId)
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
