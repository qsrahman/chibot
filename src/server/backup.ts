import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getLoadablePath } from 'sqlite-vec'
import { SCHEMA_VERSION } from './database.ts'

// A backup is a folder: a snapshot of the database, the stored files, and a
// manifest. Settings (config.json, which holds keys) and MCP sign-ins
// (mcp-auth.json) are left out on purpose, so a backup can be kept or moved
// without carrying secrets.

const MANIFEST = 'backup.json'
const DATABASE = 'chibot.db'
const FILES = 'files'

interface Manifest {
  chibot: string
  schema: number
  createdAt: string
}

export interface BackupSummary {
  chats: number
  files: number
}

/** The database at `path` opened for reading, with sqlite-vec (its tables need it). */
function openReadOnly(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: true })
  db.loadExtension(getLoadablePath())
  db.enableLoadExtension(false)
  return db
}

const schemaOf = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version

const count = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

/**
 * Copies chibot's data in `dataDir` into the new folder `target`. Safe while
 * chibot runs: the database is copied as one consistent snapshot.
 *
 * @throws Error if there is no data, or `target` already holds something
 */
export function backup(
  dataDir: string,
  target: string,
  version: string,
): BackupSummary {
  const databasePath = join(dataDir, DATABASE)
  if (!existsSync(databasePath)) {
    throw new Error(`There is no chibot data in ${dataDir}`)
  }
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`${target} already exists and is not empty`)
  }
  mkdirSync(target, { recursive: true, mode: 0o700 })

  const db = openReadOnly(databasePath)
  try {
    // VACUUM INTO writes a complete copy, however the live file is mid-write.
    db.prepare('VACUUM INTO ?').run(join(target, DATABASE))
    const manifest: Manifest = {
      chibot: version,
      schema: schemaOf(db),
      createdAt: new Date().toISOString(),
    }
    writeFileSync(
      join(target, MANIFEST),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    const files = join(dataDir, FILES)
    if (existsSync(files))
      cpSync(files, join(target, FILES), { recursive: true })
    return {
      chats: count(db, 'conversations'),
      files: count(db, 'files'),
    }
  } finally {
    db.close()
  }
}

/**
 * Puts a backup's data into `dataDir`. chibot must be stopped. Data already
 * there is an error, or with `replace` is moved aside into a
 * `before-restore-…` folder inside `dataDir`, never deleted.
 *
 * @returns what was restored, and where the earlier data went (or `null`)
 * @throws Error if `source` is not a usable backup, or chibot seems to be running
 */
export function restore(
  dataDir: string,
  source: string,
  { replace = false } = {},
): BackupSummary & { movedTo: string | null } {
  const manifestPath = join(source, MANIFEST)
  if (!existsSync(manifestPath) || !existsSync(join(source, DATABASE))) {
    throw new Error(`${source} is not a chibot backup`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
  if (manifest.schema > SCHEMA_VERSION) {
    throw new Error(
      `This backup is from a newer chibot (${manifest.chibot}); update chibot to restore it`,
    )
  }
  // Open it first, so a damaged copy fails before anything moves.
  const check = openReadOnly(join(source, DATABASE))
  let summary: BackupSummary
  try {
    summary = {
      chats: count(check, 'conversations'),
      files: count(check, 'files'),
    }
  } finally {
    check.close()
  }

  const walPath = join(dataDir, `${DATABASE}-wal`)
  if (existsSync(walPath) && statSync(walPath).size > 0) {
    throw new Error(
      'chibot seems to be running. Stop it first (if it is not, start it once and stop it again).',
    )
  }
  const existing = [
    DATABASE,
    `${DATABASE}-wal`,
    `${DATABASE}-shm`,
    FILES,
  ].filter((name) => existsSync(join(dataDir, name)))
  let movedTo: string | null = null
  if (existing.includes(DATABASE) || existing.includes(FILES)) {
    if (!replace) {
      throw new Error(
        `${dataDir} already holds chats. Use --replace to set them aside and restore the backup.`,
      )
    }
    movedTo = join(dataDir, `before-restore-${Date.now()}`)
    mkdirSync(movedTo, { recursive: true, mode: 0o700 })
    for (const name of existing) {
      renameSync(join(dataDir, name), join(movedTo, name))
    }
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  cpSync(join(source, DATABASE), join(dataDir, DATABASE))
  if (existsSync(join(source, FILES))) {
    cpSync(join(source, FILES), join(dataDir, FILES), { recursive: true })
  }
  return { ...summary, movedTo }
}
