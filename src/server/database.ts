import { DatabaseSync } from 'node:sqlite'
import { getLoadablePath } from 'sqlite-vec'
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
  // Projects. A project's chats and files are deleted with it (by
  // ProjectStore, which also clears their chunks and vectors). The vec0
  // table of chunk embeddings is created by the indexer, sized for the
  // embedding model; embedding_model records which. (vec0 reserves the
  // names chunk_vectors_*, for its own tables.)
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     instructions TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id);
   CREATE INDEX conversations_project ON conversations(project_id);
   CREATE TABLE project_files (
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     file_id TEXT NOT NULL,
     status TEXT NOT NULL, -- indexing, ready or failed
     error TEXT,
     PRIMARY KEY (project_id, file_id)
   );
   CREATE TABLE chunks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     file_id TEXT NOT NULL,
     position INTEGER NOT NULL,
     text TEXT NOT NULL
   );
   CREATE INDEX chunks_file ON chunks(file_id);
   -- rowid = chunks.id
   CREATE VIRTUAL TABLE chunks_fts USING fts5(text);
   CREATE TABLE embedding_model (model TEXT NOT NULL, dimensions INTEGER NOT NULL);`,
]

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
