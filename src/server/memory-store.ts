import type { DatabaseSync } from 'node:sqlite'
import type { Memory } from '../shared/types.ts'

export const MAX_MEMORIES = 100
export const MAX_MEMORY_LENGTH = 300

/**
 * A memory is one line: runs of whitespace (newlines included) become single
 * spaces, so its text can't add lines to the instructions that list it.
 */
export function normalizeMemory(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// Rows as `Memory` objects.
const MEMORY = 'id, text, created_at AS createdAt, updated_at AS updatedAt'

/** What chibot remembers about the user across chats. */
export class MemoryStore {
  readonly #db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.#db = db
  }

  /** Oldest first, the order the model reads them in. */
  list(): Memory[] {
    return this.#db
      .prepare(`SELECT ${MEMORY} FROM memories ORDER BY id`)
      .all() as unknown as Memory[]
  }

  get(id: number): Memory | null {
    return (
      (this.#db
        .prepare(`SELECT ${MEMORY} FROM memories WHERE id = ?`)
        .get(id) as Memory | undefined) ?? null
    )
  }

  /** The memory whose text is `text` (ignoring case and spacing), if any. */
  find(text: string): Memory | null {
    return (
      (this.#db
        .prepare(`SELECT ${MEMORY} FROM memories WHERE lower(text) = lower(?)`)
        .get(normalizeMemory(text)) as Memory | undefined) ?? null
    )
  }

  get count(): number {
    const { n } = this.#db
      .prepare('SELECT count(*) AS n FROM memories')
      .get() as { n: number }
    return n
  }

  save(text: string): Memory {
    const now = Date.now()
    return this.#db
      .prepare(
        `INSERT INTO memories (text, created_at, updated_at) VALUES (?, ?, ?)
         RETURNING ${MEMORY}`,
      )
      .get(normalizeMemory(text), now, now) as unknown as Memory
  }

  /** @returns the updated memory, or `null` if there's none with `id` */
  update(id: number, text: string): Memory | null {
    return (
      (this.#db
        .prepare(
          `UPDATE memories SET text = ?, updated_at = ? WHERE id = ?
           RETURNING ${MEMORY}`,
        )
        .get(normalizeMemory(text), Date.now(), id) as Memory | undefined) ??
      null
    )
  }

  delete(id: number): boolean {
    return (
      Number(
        this.#db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes,
      ) > 0
    )
  }

  clear(): void {
    this.#db.exec('DELETE FROM memories')
  }
}
