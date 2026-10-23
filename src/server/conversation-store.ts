import type { DatabaseSync } from 'node:sqlite'
import type {
  ResponseInputItem,
  ResponseUsage,
} from 'openai/resources/responses/responses'
import { messageText } from '../shared/messages.ts'
import type { ConversationExport } from '../shared/export.ts'
import { anyWordQuery, transaction } from './database.ts'
import type {
  ChatMatch,
  Conversation,
  ConversationListItem,
  ConversationPatch,
  StoredItem,
} from '../shared/types.ts'

interface ConversationRow {
  id: string
  title: string | null
  current_leaf_id: number | null
  pinned: number
  archived_at: number | null
  temporary: number
  project_id: string | null
  created_at: number
  updated_at: number
  snippet?: string | null
}

interface ItemRow {
  id: number
  parent_id: number | null
  data: string
  usage: string | null
  model: string | null
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

  /** @param db from `openDatabase()` */
  constructor(db: DatabaseSync) {
    this.#db = db
  }

  createConversation({
    temporary = false,
    projectId = null,
  }: { temporary?: boolean; projectId?: string | null } = {}): Conversation {
    const now = Date.now()
    const id = crypto.randomUUID()
    this.#db
      .prepare(
        `INSERT INTO conversations (id, temporary, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, temporary ? 1 : 0, projectId, now, now)
    return this.getConversation(id)!
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.#db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as ConversationRow | undefined
    return row && toConversation(row)
  }

  /**
   * Saved conversations, pinned first, then most recently active: those of
   * `projectId`, or (without one) those in no project. Archived ones are
   * listed together, wherever they are.
   */
  listConversations({
    archived = false,
    projectId = null,
  }: {
    archived?: boolean
    projectId?: string | null
  } = {}): ConversationListItem[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM conversations
          WHERE temporary = 0 AND (archived_at IS NOT NULL) = $archived
            AND ($archived OR project_id IS $projectId)
          ORDER BY pinned DESC, updated_at DESC
          LIMIT ${LIST_LIMIT}`,
      )
      .all({
        archived: archived ? 1 : 0,
        projectId,
      }) as unknown as ConversationRow[]
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

  /**
   * Finds message text for the model's `search_chats`: any word may match
   * (see `anyWordQuery`), chats ranked by their best hit, each
   * with its best few matching messages in chat order (so a question comes
   * with its answer). Temporary chats and `excludeId` (the chat asking) are
   * left out; `after` / `before` (ms) limit when a message was written.
   */
  searchMessages(
    query: string,
    {
      excludeId,
      after = null,
      before = null,
      limit = 5,
      perChat = 3,
    }: {
      excludeId: string
      after?: number | null
      before?: number | null
      limit?: number
      perChat?: number
    },
  ): ChatMatch[] {
    const match = anyWordQuery(query)
    if (!match) return []
    const rows = this.#db
      .prepare(
        // MATERIALIZED: see searchConversations.
        `WITH hits AS MATERIALIZED (
           SELECT conversation_id, rowid AS item_id, rank,
                  snippet(items_fts, 0, '', '', '…', 48) AS excerpt
             FROM items_fts WHERE items_fts MATCH $match
         ),
         ranked AS (
           SELECT h.*, c.title, i.created_at,
                  json_extract(i.data, '$.role') AS role,
                  row_number() OVER chat AS n,
                  min(h.rank) OVER chat AS best
             FROM hits h
             JOIN conversations c ON c.id = h.conversation_id
             JOIN items i ON i.id = h.item_id
            WHERE c.temporary = 0 AND c.id != $excludeId
              AND ($after IS NULL OR i.created_at >= $after)
              AND ($before IS NULL OR i.created_at < $before)
           WINDOW chat AS (PARTITION BY h.conversation_id ORDER BY h.rank
                           ROWS BETWEEN UNBOUNDED PRECEDING
                                    AND UNBOUNDED FOLLOWING)
         )
         SELECT conversation_id, title, created_at, role, excerpt FROM ranked
          WHERE n <= $perChat
            AND conversation_id IN (SELECT conversation_id FROM ranked
                                     WHERE n = 1 ORDER BY best LIMIT $limit)
          ORDER BY best, item_id`,
      )
      .all({ match, excludeId, after, before, limit, perChat }) as {
      conversation_id: string
      title: string | null
      created_at: number
      role: 'user' | 'assistant'
      excerpt: string
    }[]
    const chats = new Map<string, ChatMatch>()
    for (const row of rows) {
      let chat = chats.get(row.conversation_id)
      if (!chat) {
        chat = {
          conversationId: row.conversation_id,
          title: row.title,
          messages: [],
        }
        chats.set(row.conversation_id, chat)
      }
      chat.messages.push({
        role: row.role,
        writtenAt: row.created_at,
        excerpt: row.excerpt,
      })
    }
    return [...chats.values()]
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
    if (patch.projectId !== undefined) {
      sets.push('project_id = ?')
      values.push(patch.projectId)
    }
    if (sets.length > 0) {
      this.#db
        .prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`)
        .run(...values, id)
    }
    return this.getConversation(id)
  }

  /**
   * Sets the title only while the chat is still untitled, so a rename made
   * while the title was being generated wins.
   *
   * @returns whether the title was set
   */
  setTitleIfEmpty(id: string, title: string): boolean {
    return (
      Number(
        this.#db
          .prepare(
            'UPDATE conversations SET title = ? WHERE id = ? AND title IS NULL',
          )
          .run(title, id).changes,
      ) > 0
    )
  }

  /** Every chat in the project: archived and temporary ones too. */
  projectConversationIds(projectId: string): string[] {
    return (
      this.#db
        .prepare('SELECT id FROM conversations WHERE project_id = ?')
        .all(projectId) as { id: string }[]
    ).map(({ id }) => id)
  }

  /** @returns whether the conversation existed. */
  deleteConversation(id: string): boolean {
    let changes = 0
    transaction(this.#db, () => {
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
   * `usage` and `model` (of the response) are stored on the last item.
   */
  appendItems(
    conversationId: string,
    parentId: number | null,
    items: ResponseInputItem[],
    usage: ResponseUsage | null = null,
    model: string | null = null,
  ): StoredItem[] {
    if (items.length === 0) return []
    const insert = this.#inserter(conversationId)
    const now = Date.now()
    const stored: StoredItem[] = []
    transaction(this.#db, () => {
      let parent = parentId
      items.forEach((data, i) => {
        const last = i === items.length - 1
        const itemUsage = last ? usage : null
        const itemModel = last ? model : null
        parent = insert(parent, data, itemUsage, itemModel, now)
        stored.push({
          id: parent,
          parentId: stored.at(-1)?.id ?? parentId,
          data,
          usage: itemUsage,
          model: itemModel,
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

  /**
   * The whole tree in the JSON export format (see `ConversationExport`),
   * without the files, which `FileStore` keeps.
   */
  exportConversation(
    id: string,
  ): Omit<ConversationExport, 'files'> | undefined {
    const conversation = this.getConversation(id)
    if (!conversation) return undefined
    const rows = this.#db
      .prepare(
        `SELECT *, ${SIBLING_IDS} FROM items WHERE conversation_id = ? ORDER BY id`,
      )
      .all(id) as unknown as ItemRow[]
    return {
      version: 2,
      exportedAt: Date.now(),
      conversation: {
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      currentLeafId: conversation.currentLeafId,
      items: rows.map((row) => {
        const { siblingIds: _, ...item } = toStoredItem(row)
        return item
      }),
    }
  }

  /**
   * Adds an exported conversation as a new, saved chat (unpinned,
   * unarchived) with new ids, showing the version that was on screen.
   */
  importConversation(data: Omit<ConversationExport, 'files'>): Conversation {
    const { id } = this.createConversation()
    const insert = this.#inserter(id)
    transaction(this.#db, () => {
      // Validation guarantees parents come before their children.
      const newIds = new Map<number, number>()
      for (const item of data.items) {
        const parent =
          item.parentId === null ? null : newIds.get(item.parentId)!
        newIds.set(
          item.id,
          insert(parent, item.data, item.usage, item.model, item.createdAt),
        )
      }
      const leaf =
        data.currentLeafId === null ? null : newIds.get(data.currentLeafId)!
      this.#db
        .prepare(
          `UPDATE conversations
              SET title = ?, current_leaf_id = ?, created_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          data.conversation.title,
          leaf,
          data.conversation.createdAt,
          data.conversation.updatedAt,
          id,
        )
    })
    return this.getConversation(id)!
  }

  /** Inserts one item (and indexes its text for search); returns its id. */
  #inserter(conversationId: string) {
    const searchable = !this.getConversation(conversationId)?.temporary
    const insert = this.#db.prepare(
      `INSERT INTO items (conversation_id, parent_id, data, usage, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const index = this.#db.prepare(
      'INSERT INTO items_fts (rowid, text, conversation_id) VALUES (?, ?, ?)',
    )
    return (
      parentId: number | null,
      data: ResponseInputItem,
      usage: ResponseUsage | null,
      model: string | null,
      createdAt: number,
    ): number => {
      const id = Number(
        insert.run(
          conversationId,
          parentId,
          JSON.stringify(data),
          usage && JSON.stringify(usage),
          model,
          createdAt,
        ).lastInsertRowid,
      )
      const message = searchable && messageText(data)
      if (message) index.run(id, message.text, conversationId)
      return id
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
}

function toConversation(row: ConversationRow): ConversationListItem {
  return {
    id: row.id,
    title: row.title,
    currentLeafId: row.current_leaf_id,
    pinned: row.pinned === 1,
    archived: row.archived_at !== null,
    temporary: row.temporary === 1,
    projectId: row.project_id,
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
    model: row.model,
    siblingIds: JSON.parse(row.sibling_ids),
    createdAt: row.created_at,
  }
}
