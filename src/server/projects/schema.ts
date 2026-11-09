import type { DatabaseSync } from 'node:sqlite'

// The projects feature's schema, as migrations. `database.ts` runs them in
// its one ordered list (existing databases count them by position, so they
// can't move); the SQL lives here, beside the code that uses it.

export const PROJECT_MIGRATIONS = {
  // Projects. A project's chats and files are deleted with it (by
  // ProjectStore, which also clears their chunks and vectors). The vec0
  // table of chunk embeddings is created by the indexer, sized for the
  // embedding model; embedding_model records which. (vec0 reserves the
  // names chunk_vectors_*, for its own tables.)
  create: `CREATE TABLE projects (
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
  // Which chunker (CHUNKER_VERSION) made a project file's chunks, so a better
  // one re-indexes the files made with an older one.
  chunker: `ALTER TABLE project_files ADD COLUMN chunker INTEGER NOT NULL DEFAULT 0;`,
  // A line that tells projects apart in lists.
  description: `ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';`,
  // The PDF page a chunk starts on, when it has pages.
  page: `ALTER TABLE chunks ADD COLUMN page INTEGER;`,
  // The text put before each chunk when it was embedded: vectors made with a
  // different one don't mix, as with a different model.
  documentPrefix: `ALTER TABLE embedding_model ADD COLUMN document_prefix TEXT NOT NULL DEFAULT '';`,
  // A folder on this machine a project mirrors (ProjectSync), and for the
  // files it brought in, the modification time they had, to tell what changed.
  // Adds only what is missing: this and `documentPrefix` once ran in the wrong
  // order on some databases (before `compactions`, which shifted the others),
  // which left them with one of the two and not the other.
  folder: (db: DatabaseSync) => {
    const missing = (table: string, column: string) =>
      !(
        db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).some((c) => c.name === column)
    if (missing('embedding_model', 'document_prefix')) {
      db.exec(PROJECT_MIGRATIONS.documentPrefix)
    }
    if (missing('projects', 'folder')) {
      db.exec('ALTER TABLE projects ADD COLUMN folder TEXT')
    }
    if (missing('project_files', 'source_mtime')) {
      db.exec('ALTER TABLE project_files ADD COLUMN source_mtime INTEGER')
    }
  }, // Files are looked up by id alone (the primary key leads with the project).
  fileLookup: `CREATE INDEX IF NOT EXISTS project_files_file ON project_files(file_id);`,
}
