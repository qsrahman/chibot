import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { StoredFile } from '../shared/types.ts'
import { transaction } from './database.ts'

interface FileRow {
  id: string
  conversation_id: string | null
  name: string
  mime: string
  size: number
  created_at: number
}

/** Files chibot keeps (generated images): a row each, bytes on disk. */
export class FileStore {
  readonly #db: DatabaseSync
  readonly #dir: string

  /** @param dir where the bytes go, created if missing */
  constructor(db: DatabaseSync, dir: string) {
    this.#db = db
    this.#dir = dir
    mkdirSync(dir, { recursive: true })
  }

  save(
    conversationId: string | null,
    name: string,
    mime: string,
    data: Uint8Array,
  ): StoredFile {
    const file: StoredFile = {
      id: crypto.randomUUID(),
      conversationId,
      name,
      mime,
      size: data.byteLength,
      createdAt: Date.now(),
    }
    writeFileSync(this.#path(file.id), data)
    this.#db
      .prepare(
        `INSERT INTO files (id, conversation_id, name, mime, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(file.id, conversationId, name, mime, file.size, file.createdAt)
    return file
  }

  get(id: string): StoredFile | null {
    const row = this.#db.prepare('SELECT * FROM files WHERE id = ?').get(id) as
      FileRow | undefined
    return row ? toFile(row) : null
  }

  read(id: string) {
    return readFileSync(this.#path(id))
  }

  delete(id: string): void {
    this.#db.prepare('DELETE FROM files WHERE id = ?').run(id)
    rmSync(this.#path(id), { force: true })
  }

  /**
   * Deletes the files of conversations that no longer exist, rows and
   * bytes. Run after deleting conversations.
   */
  deleteOrphans(): number {
    const rows = this.#db
      .prepare(
        `SELECT id FROM files
          WHERE conversation_id IS NOT NULL
            AND conversation_id NOT IN (SELECT id FROM conversations)`,
      )
      .all() as { id: string }[]
    transaction(this.#db, () => {
      const remove = this.#db.prepare('DELETE FROM files WHERE id = ?')
      for (const { id } of rows) remove.run(id)
    })
    // After the commit: a crash in between leaves bytes without a row, which
    // nothing serves, rather than a row without bytes.
    for (const { id } of rows) rmSync(this.#path(id), { force: true })
    return rows.length
  }

  // Ids are our own UUIDs, never user input, so they're safe as file names.
  #path(id: string) {
    return join(this.#dir, id)
  }
}

function toFile(row: FileRow): StoredFile {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    createdAt: row.created_at,
  }
}
