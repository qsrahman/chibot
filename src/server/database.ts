import { DatabaseSync } from 'node:sqlite'
import { messageText } from '../shared/messages.ts'

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
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL -- JSON
   );`,
  // The model that wrote a response, stored with its usage on the last item.
  `ALTER TABLE items ADD COLUMN model TEXT;`,
  // Stored files (generated images); the bytes live in <data dir>/files/<id>.
  // No foreign key: deleting a conversation leaves its rows for
  // FileStore.deleteOrphans(), which also removes the files on disk.
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
]

/**
 * Opens (or creates) the SQLite database and brings its schema up to date.
 * One connection is shared by the stores.
 *
 * @param path SQLite file, or `':memory:'` for tests.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number
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
