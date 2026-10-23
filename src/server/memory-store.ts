import type { DatabaseSync } from 'node:sqlite'
import type { Memory } from '../shared/types.ts'

export const MAX_MEMORIES = 100
export const MAX_MEMORY_LENGTH = 300

interface MemoryRow {
  id: number
  text: string
  created_at: number
  updated_at: number
}

/** What chibot remembers about the user across chats. */
export class MemoryStore {
  readonly #db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.#db = db
  }

  /** Oldest first, the order the model reads them in. */
  list(): Memory[] {
    const rows = this.#db
      .prepare('SELECT * FROM memories ORDER BY id')
      .all() as unknown as MemoryRow[]
    return rows.map(toMemory)
  }

  get(id: number): Memory | null {
    const row = this.#db
      .prepare('SELECT * FROM memories WHERE id = ?')
      .get(id) as MemoryRow | undefined
    return row ? toMemory(row) : null
  }

  get count(): number {
    const { n } = this.#db
      .prepare('SELECT count(*) AS n FROM memories')
      .get() as { n: number }
    return n
  }

  save(text: string): Memory {
    const now = Date.now()
    const { lastInsertRowid } = this.#db
      .prepare(
        'INSERT INTO memories (text, created_at, updated_at) VALUES (?, ?, ?)',
      )
      .run(text, now, now)
    return this.get(Number(lastInsertRowid))!
  }

  /** @returns the updated memory, or `null` if there's none with `id` */
  update(id: number, text: string): Memory | null {
    this.#db
      .prepare('UPDATE memories SET text = ?, updated_at = ? WHERE id = ?')
      .run(text, Date.now(), id)
    return this.get(id)
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

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
