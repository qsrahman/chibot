import { chmodSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { getLoadablePath } from 'sqlite-vec'
import { messageText } from '../shared/messages.ts'
// The schema file only, not the feature's index, which imports this module.
import { PROJECT_MIGRATIONS } from './projects/schema.ts'

// Applied in order; PRAGMA user_version records how many have run. A function
// migration is for steps SQL alone can't do.
export const MIGRATIONS: (string | ((db: DatabaseSync) => void))[] = [
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
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL -- JSON
   );`,
  // The model that wrote a response, stored with its usage on the last item.
  `ALTER TABLE items ADD COLUMN model TEXT;`,
  // Stored files (generated images); the bytes live in <data dir>/files/<id>.
  // No foreign key: deleting a conversation leaves its rows for
  // FileStore.deleteOrphans() (via Attachments, which also deletes the
  // provider's copies), which removes the files on disk too.
  `CREATE TABLE files (
     id TEXT PRIMARY KEY,
     conversation_id TEXT,
     name TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX files_conversation ON files(conversation_id);`,
  `CREATE TABLE memories (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     text TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  PROJECT_MIGRATIONS.create,
  // Attachments: the id of the provider's (Files API) copy, uploaded once.
  `ALTER TABLE files ADD COLUMN provider_file_id TEXT;`,
  PROJECT_MIGRATIONS.chunker,
  PROJECT_MIGRATIONS.description,
  PROJECT_MIGRATIONS.page,
  // Summaries that stand in for the items up to one on the path (CONTEXT.md §5).
  `CREATE TABLE compactions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     up_to_item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
     summary TEXT NOT NULL,
     summary_model TEXT NOT NULL,
     tokens_before INTEGER NOT NULL,
     tokens_after INTEGER NOT NULL,
     previous_id INTEGER,
     degraded INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX compactions_conversation ON compactions(conversation_id);`,
  PROJECT_MIGRATIONS.documentPrefix,
  PROJECT_MIGRATIONS.folder,
  // A chat's items are read by conversation: its path, usage and branches.
  `CREATE INDEX IF NOT EXISTS items_conversation ON items(conversation_id, id);`,
  PROJECT_MIGRATIONS.fileLookup,
]

/** How many migrations this version of chibot knows: the newest schema it can open. */
export const SCHEMA_VERSION = MIGRATIONS.length

/**
 * Opens (or creates) the SQLite database, with sqlite-vec loaded, and brings
 * its schema up to date. One connection is shared by the stores.
 *
 * @param path SQLite file, or `':memory:'` for tests.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { allowExtension: true })
  // sqlite-vec adds vec0 tables (project file embeddings). Loading is then
  // switched off again, so SQL can't load extensions of its own.
  db.loadExtension(getLoadablePath())
  db.enableLoadExtension(false)
  // Appending to a log instead of rewriting a journal makes the many small
  // writes of a streaming answer cheaper, and readers don't wait for writers.
  // (A file setting: it stays, and the in-memory test databases ignore it.)
  db.exec('PRAGMA journal_mode = WAL')
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number
  }
  if (version > MIGRATIONS.length) {
    db.close()
    throw new Error(
      `Database schema ${version} is newer than this version of chibot supports (${MIGRATIONS.length})`,
    )
  }
  // An existing database about to change gets a copy first: a migration that
  // goes wrong in a way no transaction undoes leaves something to restore.
  if (version > 0 && version < MIGRATIONS.length && path !== ':memory:') {
    const copy = `${path}.before-upgrade`
    rmSync(copy, { force: true })
    db.prepare('VACUUM INTO ?').run(copy)
    chmodSync(copy, 0o600) // it holds the chats
    console.info(
      `Upgrading the database from version ${version} to ${MIGRATIONS.length}; a copy of the old one is at ${copy}`,
    )
  }
  MIGRATIONS.slice(version).forEach((migration, i) => {
    transaction(db, () => {
      if (typeof migration === 'string') db.exec(migration)
      else migration(db)
      // PRAGMA doesn't accept bound parameters.
      db.exec(`PRAGMA user_version = ${version + i + 1}`)
    })
  })
  return db
}

/**
 * An FTS5 query matching any word of `text` (for the model's searches,
 * which are whole phrases). Words are quoted, so FTS5 operators in them
 * aren't parsed. Words of 4 letters or more also match as prefixes; shorter
 * ones only whole, or "do" would find "door". `null` when there are no words.
 * With `stopwords`, common English filler words are left out.
 */
export function anyWordQuery(
  text: string,
  { stopwords = false } = {},
): string | null {
  let words = text.split(/\s+/).filter(Boolean)
  if (stopwords) {
    // A question's filler ("how do I …") matches nearly every passage and
    // crowds out the words that carry the meaning; a query of nothing else
    // keeps its words.
    const kept = words.filter(
      (w) => !STOPWORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')),
    )
    if (kept.length > 0) words = kept
  }
  if (words.length === 0) return null
  return words
    .map((w) => `"${w.replaceAll('"', '""')}"${w.length >= 4 ? '*' : ''}`)
    .join(' OR ')
}

// English filler. In other languages the same letters are mostly filler too.
const STOPWORDS = new Set(
  `a an the of to in on at for and or is are was were be been it its this that
  these those what which who whom how when where why do does did can could
  should would will with from by as about into than then there their they them
  you your i we our not no`.split(/\s+/),
)

/** Runs `fn` in a transaction, rolling back if it throws. */
export function transaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
