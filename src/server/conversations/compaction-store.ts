import type { DatabaseSync } from 'node:sqlite'
import type { Compaction } from '../../shared/types.ts'

type NewCompaction = Omit<Compaction, 'id' | 'createdAt'>

interface CompactionRow {
  id: number
  upToItemId: number
  summary: string
  summaryModel: string
  tokensBefore: number
  tokensAfter: number
  previousId: number | null
  degraded: number
  createdAt: number
}

const COLUMNS = `id, up_to_item_id AS upToItemId, summary,
  summary_model AS summaryModel, tokens_before AS tokensBefore,
  tokens_after AS tokensAfter, previous_id AS previousId, degraded,
  created_at AS createdAt`

/** The summaries that stand in for the start of long chats. */
export class CompactionStore {
  readonly #db: DatabaseSync

  /** @param db from `openDatabase()` */
  constructor(db: DatabaseSync) {
    this.#db = db
  }

  add(conversationId: string, c: NewCompaction): Compaction {
    const row = this.#db
      .prepare(
        `INSERT INTO compactions
           (conversation_id, up_to_item_id, summary, summary_model,
            tokens_before, tokens_after, previous_id, degraded, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${COLUMNS}`,
      )
      .get(
        conversationId,
        c.upToItemId,
        c.summary,
        c.summaryModel,
        c.tokensBefore,
        c.tokensAfter,
        c.previousId,
        c.degraded ? 1 : 0,
        Date.now(),
      ) as unknown as CompactionRow
    return toCompaction(row)
  }

  /** Every compaction of the chat, oldest first, on whatever branch. */
  list(conversationId: string): Compaction[] {
    return (
      this.#db
        .prepare(
          `SELECT ${COLUMNS} FROM compactions
            WHERE conversation_id = ? ORDER BY id`,
        )
        .all(conversationId) as unknown as CompactionRow[]
    ).map(toCompaction)
  }

  /** Undo: the chat goes back to the messages the summary stood for. */
  delete(conversationId: string, id: number): boolean {
    return (
      Number(
        this.#db
          .prepare(
            'DELETE FROM compactions WHERE conversation_id = ? AND id = ?',
          )
          .run(conversationId, id).changes,
      ) > 0
    )
  }
}

const toCompaction = (row: CompactionRow): Compaction => ({
  ...row,
  degraded: Boolean(row.degraded),
})
