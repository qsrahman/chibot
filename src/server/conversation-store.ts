import { DatabaseSync } from 'node:sqlite'
import type {
  ResponseInputItem,
  ResponseUsage,
} from 'openai/resources/responses/responses'
import { messageText } from '../shared/messages.ts'
import type {
  Conversation,
  ConversationListItem,
  ConversationPatch,
  StoredItem,
} from '../shared/types.ts'

// Applied in order; PRAGMA user_version records how many have run. A function
// migration is for steps SQL alone can't do.
const MIGRATIONS: (string | ((db: DatabaseSync) => void))[] = [
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
  (db) => {
    db.exec(
      `ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
       ALTER TABLE conversations ADD COLUMN archived_at INTEGER;
       ALTER TABLE conversations ADD COLUMN temporary INTEGER NOT NULL DEFAULT 0;
       -- rowid = items.id, so an item's text can be found or removed by id.
       CREATE VIRTUAL TABLE items_fts USING fts5(text, conversation_id UNINDEXED);`,
    )
    const index = db.prepare(
      'INSERT INTO items_fts (rowid, text, conversation_id) VALUES (?, ?, ?)',
    )
    const rows = db
      .prepare('SELECT id, conversation_id, data FROM items')
      .all() as { id: number; conversation_id: string; data: string }[]
    for (const row of rows) {
      const message = messageText(JSON.parse(row.data))
      if (message) index.run(row.id, message.text, row.conversation_id)
    }
  },
]

interface ConversationRow {
  id: string
  title: string | null
  current_leaf_id: number | null
  pinned: number
  archived_at: number | null
  temporary: number
  created_at: number
  updated_at: number
  snippet?: string | null
}

interface ItemRow {
  id: number
  parent_id: number | null
  data: string
  usage: string | null
  sibling_ids: string
  created_at: number
}

// This item and the others under the same parent, oldest first, as JSON.
const SIBLING_IDS = `(
  SELECT json_group_array(id) FROM (
    SELECT s.id FROM items s
     WHERE s.conversation_id = items.conversation_id
       AND s.parent_id IS items.parent_id
     ORDER BY s.id
  )
) AS sibling_ids`

const LIST_LIMIT = 200
const SEARCH_LIMIT = 50

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

  createConversation({ temporary = false } = {}): Conversation {
    const now = Date.now()
    const id = crypto.randomUUID()
    this.#db
      .prepare(
        `INSERT INTO conversations (id, temporary, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, temporary ? 1 : 0, now, now)
    return this.getConversation(id)!
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.#db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as ConversationRow | undefined
    return row && toConversation(row)
  }

  /** Saved conversations, pinned first, then most recently active. */
  listConversations({ archived = false } = {}): ConversationListItem[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM conversations
          WHERE temporary = 0 AND (archived_at IS NOT NULL) = ?
          ORDER BY pinned DESC, updated_at DESC
          LIMIT ${LIST_LIMIT}`,
      )
      .all(archived ? 1 : 0) as unknown as ConversationRow[]
    return rows.map(toConversation)
  }

  /**
   * Saved conversations (archived included) whose title or message text
   * matches every word of `query` as a prefix. Message hits carry a snippet.
   */
  searchConversations(query: string): ConversationListItem[] {
    const words = query.split(/\s+/).filter(Boolean)
    if (words.length === 0) return []
    // Quoting each word keeps FTS5 operators in user input from being parsed.
    const match = words.map((w) => `"${w.replaceAll('"', '""')}"*`).join(' ')
    const like = `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const rows = this.#db
      .prepare(
        // MATERIALIZED: snippet() only works in the FTS query itself, not
        // after SQLite flattens the CTE into the outer query.
        `WITH hits AS MATERIALIZED (
           SELECT conversation_id,
                  snippet(items_fts, 0, '', '', '…', 16) AS snippet,
                  rank
             FROM items_fts WHERE items_fts MATCH ?
         ),
         best AS (
           SELECT conversation_id, snippet, min(rank) FROM hits
            GROUP BY conversation_id
         )
         SELECT c.*, best.snippet FROM conversations c
           LEFT JOIN best ON best.conversation_id = c.id
          WHERE c.temporary = 0
            AND (best.conversation_id IS NOT NULL OR c.title LIKE ? ESCAPE '\\')
          ORDER BY c.pinned DESC, c.updated_at DESC
          LIMIT ${SEARCH_LIMIT}`,
      )
      .all(match, like) as unknown as ConversationRow[]
    return rows.map(toConversation)
  }

  /** Renames, pins or archives. Doesn't count as activity for sorting. */
  updateConversation(
    id: string,
    patch: ConversationPatch,
  ): Conversation | undefined {
    const sets: string[] = []
    const values: (string | number | null)[] = []
    if (patch.title !== undefined) {
      sets.push('title = ?')
      values.push(patch.title)
    }
    if (patch.pinned !== undefined) {
      sets.push('pinned = ?')
      values.push(patch.pinned ? 1 : 0)
    }
    if (patch.archived !== undefined) {
      sets.push('archived_at = ?')
      values.push(patch.archived ? Date.now() : null)
    }
    if (sets.length > 0) {
      this.#db
        .prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`)
        .run(...values, id)
    }
    return this.getConversation(id)
  }

  /** @returns whether the conversation existed. */
  deleteConversation(id: string): boolean {
    let changes = 0
    this.#transaction(() => {
      // The FTS table has no foreign key, so its rows go explicitly.
      this.#db
        .prepare('DELETE FROM items_fts WHERE conversation_id = ?')
        .run(id)
      changes = Number(
        this.#db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
          .changes,
      )
    })
    return changes > 0
  }

  /** Removes temporary chats left behind (e.g. by a closed browser). */
  deleteTemporaryConversations(): number {
    const ids = this.#db
      .prepare('SELECT id FROM conversations WHERE temporary = 1')
      .all() as { id: string }[]
    ids.forEach(({ id }) => this.deleteConversation(id))
    return ids.length
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
    const searchable = !this.getConversation(conversationId)?.temporary
    const now = Date.now()
    const insert = this.#db.prepare(
      `INSERT INTO items (conversation_id, parent_id, data, usage, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    const index = this.#db.prepare(
      'INSERT INTO items_fts (rowid, text, conversation_id) VALUES (?, ?, ?)',
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
        const message = searchable && messageText(data)
        if (message) index.run(parent, message.text, conversationId)
        stored.push({
          id: parent,
          parentId: stored.at(-1)?.id ?? parentId,
          data,
          usage: itemUsage,
          siblingIds: [parent],
          createdAt: now,
        })
      })
      // Only the first item can have siblings: the rest of the chain is new.
      stored[0]!.siblingIds = this.#siblingIds(conversationId, parentId)
      this.#db
        .prepare(
          'UPDATE conversations SET current_leaf_id = ?, updated_at = ? WHERE id = ?',
        )
        .run(parent, now, conversationId)
    })
    return stored
  }

  /**
   * Items from the root to the conversation's current leaf, or to `itemId`
   * when given (empty if that item isn't in the conversation).
   */
  getPath(conversationId: string, itemId?: number): StoredItem[] {
    const start =
      itemId === undefined
        ? `SELECT current_leaf_id, 0 FROM conversations
            WHERE id = ?1 AND current_leaf_id IS NOT NULL`
        : `SELECT id, 0 FROM items WHERE conversation_id = ?1 AND id = ?2`
    const rows = this.#db
      .prepare(
        `WITH RECURSIVE path(id, depth) AS (
           ${start}
           UNION ALL
           SELECT items.parent_id, path.depth + 1 FROM items
             JOIN path ON items.id = path.id
            WHERE items.parent_id IS NOT NULL
         )
         SELECT items.*, ${SIBLING_IDS}
           FROM path JOIN items ON items.id = path.id
          ORDER BY path.depth DESC`,
      )
      .all(
        ...(itemId === undefined ? [conversationId] : [conversationId, itemId]),
      ) as unknown as ItemRow[]
    return rows.map(toStoredItem)
  }

  getItem(conversationId: string, itemId: number): StoredItem | undefined {
    const row = this.#db
      .prepare(
        `SELECT items.*, ${SIBLING_IDS} FROM items
          WHERE conversation_id = ? AND id = ?`,
      )
      .get(conversationId, itemId) as ItemRow | undefined
    return row && toStoredItem(row)
  }

  /**
   * Shows another version: makes the newest item at or below `itemId` the
   * current leaf, so each version keeps its own follow-up messages.
   * (The newest item in a subtree is always a leaf: any child would be newer.)
   *
   * @returns whether `itemId` is in the conversation
   */
  switchToVersion(conversationId: string, itemId: number): boolean {
    const { leaf } = this.#db
      .prepare(
        `WITH RECURSIVE below(id) AS (
           SELECT id FROM items WHERE conversation_id = ? AND id = ?
           UNION ALL
           SELECT items.id FROM items JOIN below ON items.parent_id = below.id
         )
         SELECT max(id) AS leaf FROM below`,
      )
      .get(conversationId, itemId) as { leaf: number | null }
    if (leaf === null) return false
    this.#db
      .prepare('UPDATE conversations SET current_leaf_id = ? WHERE id = ?')
      .run(leaf, conversationId)
    return true
  }

  /** Tokens used by all responses in the conversation, all versions included. */
  getUsageTotals(conversationId: string): ResponseUsage {
    const sum = (path: string) =>
      `coalesce(sum(json_extract(usage, '$.${path}')), 0)`
    const row = this.#db
      .prepare(
        `SELECT ${sum('input_tokens')} AS input,
                ${sum('input_tokens_details.cached_tokens')} AS cached,
                ${sum('input_tokens_details.cache_write_tokens')} AS cacheWrite,
                ${sum('output_tokens')} AS output,
                ${sum('output_tokens_details.reasoning_tokens')} AS reasoning,
                ${sum('total_tokens')} AS total
           FROM items WHERE conversation_id = ? AND usage IS NOT NULL`,
      )
      .get(conversationId) as Record<
      'input' | 'cached' | 'cacheWrite' | 'output' | 'reasoning' | 'total',
      number
    >
    return {
      input_tokens: row.input,
      input_tokens_details: {
        cached_tokens: row.cached,
        cache_write_tokens: row.cacheWrite,
      },
      output_tokens: row.output,
      output_tokens_details: { reasoning_tokens: row.reasoning },
      total_tokens: row.total,
    }
  }

  #siblingIds(conversationId: string, parentId: number | null): number[] {
    const rows = this.#db
      .prepare(
        `SELECT id FROM items
          WHERE conversation_id = ? AND parent_id IS ? ORDER BY id`,
      )
      .all(conversationId, parentId) as { id: number }[]
    return rows.map((r) => r.id)
  }

  #migrate(): void {
    const { user_version: version } = this.#db
      .prepare('PRAGMA user_version')
      .get() as { user_version: number }
    MIGRATIONS.slice(version).forEach((migration, i) => {
      this.#transaction(() => {
        if (typeof migration === 'string') this.#db.exec(migration)
        else migration(this.#db)
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

function toConversation(row: ConversationRow): ConversationListItem {
  return {
    id: row.id,
    title: row.title,
    currentLeafId: row.current_leaf_id,
    pinned: row.pinned === 1,
    archived: row.archived_at !== null,
    temporary: row.temporary === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.snippet ? { snippet: row.snippet } : {}),
  }
}

function toStoredItem(row: ItemRow): StoredItem {
  return {
    id: row.id,
    parentId: row.parent_id,
    data: JSON.parse(row.data),
    usage: row.usage && JSON.parse(row.usage),
    siblingIds: JSON.parse(row.sibling_ids),
    createdAt: row.created_at,
  }
}
