import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS, openDatabase } from '../../src/server/database.ts'

describe('openDatabase', () => {
  it('loads sqlite-vec for nearest-neighbour search', () => {
    const db = openDatabase(':memory:')
    db.exec(
      'CREATE VIRTUAL TABLE v USING vec0(embedding float[2] distance_metric=cosine)',
    )
    const insert = db.prepare('INSERT INTO v (rowid, embedding) VALUES (?, ?)')
    // vec0 rowids must be bound as integers: node:sqlite binds BigInts so.
    insert.run(1n, new Float32Array([1, 0]))
    insert.run(2n, new Float32Array([0, 1]))
    const nearest = db
      .prepare('SELECT rowid FROM v WHERE embedding MATCH ? AND k = 1')
      .get(new Float32Array([0.9, 0.1])) as { rowid: number }
    expect(nearest.rowid).toBe(1)
  })

  it("doesn't let SQL load extensions", () => {
    const db = openDatabase(':memory:')
    expect(() => db.exec("SELECT load_extension('x')")).toThrow()
  })

  it('refuses a database from a newer version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chibot-db-'))
    const file = join(dir, 'chibot.db')
    try {
      const db = openDatabase(file)
      db.exec('PRAGMA user_version = 999')
      db.close()
      expect(() => openDatabase(file)).toThrow(/newer than this version/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Existing databases count migrations by position, so a new one goes at the
  // end of the list; one put in the middle runs an old step again (and skips
  // itself) on every database made before. When you add a migration, leave
  // this alone: it covers the ones that existed when it was written.
  it('keeps the migrations that are already out in their place', () => {
    const KNOWN = 12
    // A function's name, not its source, which tools write differently.
    const text = (m: unknown) =>
      typeof m === 'string' ? m : (m as Function).name
    const hash = createHash('sha256')
      .update(MIGRATIONS.slice(0, KNOWN).map(text).join('\n--\n'))
      .digest('hex')
    expect(hash).toBe(
      'fefc7f8602555dcd9ce398b94e82fd5c6de5e50599f3e143926425d1eeea294c',
    )
  })

  // Version 12 is a database from before the embedding prefix and the
  // mirrored folder; the other is one that got the folder step but not the
  // prefix one, when they ran out of order.
  it.each([
    ['from before the prefix and folder columns', 12, true],
    ['that has the folder columns but not the prefix', 13, false],
  ])('brings a database %s up to date', (_, version, dropFolder) => {
    const dir = mkdtempSync(join(tmpdir(), 'chibot-db-'))
    const file = join(dir, 'chibot.db')
    try {
      openDatabase(file).close()
      const old = new DatabaseSync(file)
      old.exec('ALTER TABLE embedding_model DROP COLUMN document_prefix')
      if (dropFolder) {
        old.exec(
          `ALTER TABLE projects DROP COLUMN folder;
           ALTER TABLE project_files DROP COLUMN source_mtime`,
        )
      }
      old.exec(`PRAGMA user_version = ${version}`)
      old.close()
      const db = openDatabase(file)
      const columns = (table: string) =>
        (
          db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        ).map((c) => c.name)
      expect(columns('embedding_model')).toContain('document_prefix')
      expect(columns('projects')).toContain('folder')
      expect(columns('project_files')).toContain('source_mtime')
      expect(
        (db.prepare('PRAGMA user_version').get() as { user_version: number })
          .user_version,
      ).toBe(MIGRATIONS.length)
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("reads a chat's items and a project file by index, not by scanning", () => {
    const db = openDatabase(':memory:')
    const plan = (sql: string) =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('x') as { detail: string }[])
        .map((r) => r.detail)
        .join('; ')
    expect(
      plan('SELECT * FROM items WHERE conversation_id = ? ORDER BY id'),
    ).toContain('USING INDEX items_conversation')
    expect(plan('SELECT * FROM project_files WHERE file_id = ?')).toContain(
      'project_files_file',
    )
  })

  it('writes a file database in WAL mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chibot-db-'))
    try {
      const db = openDatabase(join(dir, 'chibot.db'))
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({
        journal_mode: 'wal',
      })
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('adds the indexes to a database made without them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chibot-db-'))
    const file = join(dir, 'chibot.db')
    try {
      openDatabase(file).close()
      const old = new DatabaseSync(file)
      old.exec(
        `DROP INDEX items_conversation;
         DROP INDEX project_files_file;
         PRAGMA user_version = ${MIGRATIONS.length - 2}`,
      )
      old.close()
      const db = openDatabase(file)
      const indexes = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
          .all() as { name: string }[]
      ).map((i) => i.name)
      expect(indexes).toContain('items_conversation')
      expect(indexes).toContain('project_files_file')
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
