import { DatabaseSync } from 'node:sqlite'
import type {
  ResponseInputItem,
  ResponseUsage,
} from 'openai/resources/responses/responses'
import type { Conversation, StoredItem } from '../shared/types.ts'

// Applied in order; PRAGMA user_version records how many have run.
const MIGRATIONS = [
  `CREATE TABLE conversations (
     id TEXT PRIMARY KEY,
     title TEXT,
     current_leaf_id INTEGER,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     parent_id INTEGER REFERENCES items(id),
     data TEXT NOT NULL,
     usage TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX items_parent ON items(parent_id);`,
]

interface ConversationRow {
  id: string
  title: string | null
  current_leaf_id: number | null
  created_at: number
  updated_at: number
}

interface ItemRow {
  id: number
  parent_id: number | null
  data: string
  usage: string | null
  created_at: number
}

/** Conversations and their history trees, persisted in SQLite. */
export class ConversationStore {
  readonly #db: DatabaseSync

  /** @param path SQLite file, or `':memory:'` for tests. */
  constructor(path: string) {
    this.#db = new DatabaseSync(path)
    this.#migrate()
  }

  close(): void {
    this.#db.close()
  }

  createConversation(): Conversation {
    const now = Date.now()
    const id = crypto.randomUUID()
    this.#db
      .prepare(
        'INSERT INTO conversations (id, created_at, updated_at) VALUES (?, ?, ?)',
      )
      .run(id, now, now)
    return this.getConversation(id)!
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.#db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as ConversationRow | undefined
    return row && toConversation(row)
  }

  /**
   * Appends `items` as a chain below `parentId` (each item the parent of the
   * next) and makes the last one the conversation's current leaf.
   * `usage` is stored on the last item.
   */
  appendItems(
    conversationId: string,
    parentId: number | null,
    items: ResponseInputItem[],
    usage: ResponseUsage | null = null,
  ): StoredItem[] {
    if (items.length === 0) return []
    const now = Date.now()
    const insert = this.#db.prepare(
      `INSERT INTO items (conversation_id, parent_id, data, usage, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    const stored: StoredItem[] = []
    this.#transaction(() => {
      let parent = parentId
      items.forEach((data, i) => {
        const itemUsage = i === items.length - 1 ? usage : null
        const { lastInsertRowid } = insert.run(
          conversationId,
          parent,
          JSON.stringify(data),
          itemUsage && JSON.stringify(itemUsage),
          now,
        )
        parent = Number(lastInsertRowid)
        stored.push({
          id: parent,
          parentId: stored.at(-1)?.id ?? parentId,
          data,
          usage: itemUsage,
          createdAt: now,
        })
      })
      this.#db
        .prepare(
          'UPDATE conversations SET current_leaf_id = ?, updated_at = ? WHERE id = ?',
        )
        .run(parent, now, conversationId)
    })
    return stored
  }

  /** Items from the root to the conversation's current leaf. */
  getPath(conversationId: string): StoredItem[] {
    const rows = this.#db
      .prepare(
        `WITH RECURSIVE path(id, depth) AS (
           SELECT current_leaf_id, 0 FROM conversations
            WHERE id = ? AND current_leaf_id IS NOT NULL
           UNION ALL
           SELECT items.parent_id, path.depth + 1 FROM items
             JOIN path ON items.id = path.id
            WHERE items.parent_id IS NOT NULL
         )
         SELECT items.* FROM path JOIN items ON items.id = path.id
          ORDER BY path.depth DESC`,
      )
      .all(conversationId) as unknown as ItemRow[]
    return rows.map(toStoredItem)
  }

  #migrate(): void {
    const { user_version: version } = this.#db
      .prepare('PRAGMA user_version')
      .get() as { user_version: number }
    MIGRATIONS.slice(version).forEach((sql, i) => {
      this.#transaction(() => {
        this.#db.exec(sql)
        // PRAGMA doesn't accept bound parameters.
        this.#db.exec(`PRAGMA user_version = ${version + i + 1}`)
      })
    })
  }

  #transaction(fn: () => void): void {
    this.#db.exec('BEGIN')
    try {
      fn()
      this.#db.exec('COMMIT')
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }
  }
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    currentLeafId: row.current_leaf_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toStoredItem(row: ItemRow): StoredItem {
  return {
    id: row.id,
    parentId: row.parent_id,
    data: JSON.parse(row.data),
    usage: row.usage && JSON.parse(row.usage),
    createdAt: row.created_at,
  }
}
