import type { DatabaseSync } from 'node:sqlite'
import { anyWordQuery } from './database.ts'
import { toConversation, type ConversationRow } from './conversation-store.ts'
import type { ChatMatch, ConversationListItem } from '../shared/types.ts'

const SEARCH_LIMIT = 50

/** Full-text search over the conversations `ConversationStore` keeps. */
export class ConversationSearch {
  readonly #db: DatabaseSync

  /** @param db the one `ConversationStore` uses */
  constructor(db: DatabaseSync) {
    this.#db = db
  }

  /**
   * Saved conversations (archived included) whose title or message text
   * matches every word of `query` as a prefix. Message hits carry a snippet.
   */
  conversations(query: string): ConversationListItem[] {
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
  messages(
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
        // MATERIALIZED: see conversations.
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
}
