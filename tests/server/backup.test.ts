import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backup, restore } from '../../src/server/backup.ts'
import { ConversationStore } from '../../src/server/conversations/index.ts'
import { openDatabase } from '../../src/server/database.ts'
import { FileStore } from '../../src/server/file-store.ts'

describe('backup and restore', () => {
  let dir: string
  let data: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chibot-backup-'))
    data = join(dir, 'data')
    mkdirSync(data)
    const db = openDatabase(join(data, 'chibot.db'))
    const store = new ConversationStore(db)
    const chat = store.createConversation()
    new FileStore(db, join(data, 'files')).save(
      chat.id,
      'note.txt',
      'text/plain',
      new TextEncoder().encode('hello file'),
    )
    // Embeddings of project files live in a vec0 table, created on demand.
    db.exec('CREATE VIRTUAL TABLE vectors USING vec0(embedding float[2])')
    db.prepare('INSERT INTO vectors(rowid, embedding) VALUES (1, ?)').run(
      new Float32Array([1, 2]),
    )
    db.close()
  })
  afterEach(() => rmSync(dir, { recursive: true }))

  const made = () => backup(data, join(dir, 'copy'), '9.9.9')

  it('copies the chats, the files and the vectors, with a manifest', () => {
    expect(made()).toEqual({ chats: 1, files: 1 })
    const manifest = JSON.parse(
      readFileSync(join(dir, 'copy/backup.json'), 'utf8'),
    )
    expect(manifest).toMatchObject({
      chibot: '9.9.9',
      schema: expect.any(Number),
    })
    // Settings and sign-ins hold secrets and are not copied.
    writeFileSync(join(data, 'mcp-auth.json'), '{}')
    rmSync(join(dir, 'copy'), { recursive: true })
    made()
    expect(readdirSync(join(dir, 'copy')).sort()).toEqual([
      'backup.json',
      'chibot.db',
      'files',
    ])
  })

  it('restores into an empty folder, with the files and vectors', () => {
    made()
    const fresh = join(dir, 'fresh')
    expect(restore(fresh, join(dir, 'copy'))).toEqual({
      chats: 1,
      files: 1,
      movedTo: null,
    })
    const db = openDatabase(join(fresh, 'chibot.db'))
    expect(new ConversationStore(db).listConversations()).toHaveLength(1)
    const [file] = db.prepare('SELECT id FROM files').all() as { id: string }[]
    expect(readFileSync(join(fresh, 'files', file!.id), 'utf8')).toBe(
      'hello file',
    )
    expect(db.prepare('SELECT COUNT(*) AS n FROM vectors').get()).toMatchObject(
      { n: 1 },
    )
    db.close()
  })

  it('does not overwrite chats unless told to, and then sets them aside', () => {
    made()
    expect(() => restore(data, join(dir, 'copy'))).toThrow('--replace')
    const result = restore(data, join(dir, 'copy'), { replace: true })
    expect(result.movedTo).toMatch(/before-restore-/)
    expect(existsSync(join(result.movedTo!, 'chibot.db'))).toBe(true)
    expect(existsSync(join(result.movedTo!, 'files'))).toBe(true)
    expect(existsSync(join(data, 'chibot.db'))).toBe(true)
  })

  it('refuses while chibot seems to be running', () => {
    made()
    writeFileSync(join(data, 'chibot.db-wal'), 'x')
    expect(() => restore(data, join(dir, 'copy'), { replace: true })).toThrow(
      'seems to be running',
    )
  })

  it('refuses what is not a usable backup, or a folder that is in use', () => {
    expect(() => restore(data, dir)).toThrow('not a chibot backup')
    made()
    expect(() => made()).toThrow('not empty')
    const manifest = join(dir, 'copy/backup.json')
    writeFileSync(manifest, JSON.stringify({ chibot: '99', schema: 9999 }))
    expect(() => restore(join(dir, 'x'), join(dir, 'copy'))).toThrow(
      'newer chibot',
    )
    expect(() => backup(join(dir, 'nothing'), join(dir, 'c2'), '1')).toThrow(
      'no chibot data',
    )
  })
})
