import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { StoredFile } from '../shared/types.ts'
import { transaction } from './database.ts'

// Rows as `StoredFile` objects.
const FILE = `id, conversation_id AS conversationId, name, mime, size,
  created_at AS createdAt, provider_file_id AS providerFileId`

/** Files chibot keeps (generated images, uploads): a row each, bytes on disk. */
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
      providerFileId: null,
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
    return (
      (this.#db.prepare(`SELECT ${FILE} FROM files WHERE id = ?`).get(id) as
        StoredFile | undefined) ?? null
    )
  }

  /** Makes uploads attached to a message part of its conversation. */
  link(ids: string[], conversationId: string): void {
    const update = this.#db.prepare(
      'UPDATE files SET conversation_id = ? WHERE id = ? AND conversation_id IS NULL',
    )
    for (const id of ids) update.run(conversationId, id)
  }

  /** Records (or with `null`, forgets) the provider's copy of a file. */
  setProviderId(id: string, providerFileId: string | null): void {
    this.#db
      .prepare('UPDATE files SET provider_file_id = ? WHERE id = ?')
      .run(providerFileId, id)
  }

  read(id: string) {
    return readFileSync(this.#path(id))
  }

  delete(id: string): void {
    this.#db.prepare('DELETE FROM files WHERE id = ?').run(id)
    rmSync(this.#path(id), { force: true })
  }

  /**
   * Deletes, rows and bytes, the files of conversations that no longer
   * exist, and uploads that were never attached (a day gives the client time
   * to attach them). Run after deleting conversations, and at startup.
   *
   * @returns the provider copies of the deleted files, to delete there too
   */
  deleteOrphans(): string[] {
    const rows = this.#db
      .prepare(
        `SELECT id, provider_file_id AS providerFileId FROM files
          WHERE (conversation_id IS NOT NULL
                 AND conversation_id NOT IN (SELECT id FROM conversations))
             OR (conversation_id IS NULL
                 AND id NOT IN (SELECT file_id FROM project_files)
                 AND created_at < ?)`,
      )
      .all(Date.now() - 24 * 60 * 60 * 1000) as {
      id: string
      providerFileId: string | null
    }[]
    transaction(this.#db, () => {
      const remove = this.#db.prepare('DELETE FROM files WHERE id = ?')
      for (const { id } of rows) remove.run(id)
    })
    // After the commit: a crash in between leaves bytes without a row, which
    // nothing serves, rather than a row without bytes.
    for (const { id } of rows) rmSync(this.#path(id), { force: true })
    return rows.flatMap(({ providerFileId }) => providerFileId ?? [])
  }

  // Ids are our own UUIDs, never user input, so they're safe as file names.
  #path(id: string) {
    return join(this.#dir, id)
  }
}
