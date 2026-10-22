import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ConversationStore } from '../../src/server/conversation-store.ts'

describe('ConversationStore lists, search and lifecycle', () => {
  let store: ConversationStore
  beforeEach(() => {
    store = new ConversationStore(':memory:')
  })
  afterEach(() => store.close())

  /** A saved conversation with one exchange, so it has a recent update. */
  function chat(question: string, answer = 'ok', title?: string) {
    const { id } = store.createConversation()
    const [q] = store.appendItems(id, null, [
      { role: 'user', content: question },
    ])
    store.appendItems(id, q!.id, [{ role: 'assistant', content: answer }])
    if (title) store.updateConversation(id, { title })
    return id
  }

  const ids = (list: { id: string }[]) => list.map((c) => c.id)

  it('lists pinned first, then most recently active', async () => {
    const a = chat('first')
    await new Promise((r) => setTimeout(r, 5))
    const b = chat('second')
    expect(ids(store.listConversations())).toEqual([b, a])

    store.updateConversation(a, { pinned: true })
    expect(ids(store.listConversations())).toEqual([a, b])
    expect(store.getConversation(a)!.pinned).toBe(true)
  })

  it('renames without reordering', async () => {
    const a = chat('first')
    await new Promise((r) => setTimeout(r, 5))
    const b = chat('second')
    store.updateConversation(a, { title: 'Renamed' })
    expect(store.listConversations().map((c) => [c.id, c.title])).toEqual([
      [b, null],
      [a, 'Renamed'],
    ])
  })

  it('archives into a separate list and restores', () => {
    const a = chat('first')
    const b = chat('second')
    store.updateConversation(a, { archived: true })
    expect(ids(store.listConversations())).toEqual([b])
    expect(ids(store.listConversations({ archived: true }))).toEqual([a])

    store.updateConversation(a, { archived: false })
    expect(ids(store.listConversations({ archived: true }))).toEqual([])
    expect(ids(store.listConversations())).toContain(a)
  })

  it('deletes a conversation with its items and search text', () => {
    const a = chat('unique pangolin question')
    expect(store.deleteConversation(a)).toBe(true)
    expect(store.getConversation(a)).toBeUndefined()
    expect(store.getPath(a)).toEqual([])
    expect(store.searchConversations('pangolin')).toEqual([])
    expect(store.deleteConversation(a)).toBe(false)
  })

  it('searches message text by word prefix, with a snippet', () => {
    const a = chat('How do pangolins defend themselves?', 'They roll up.')
    chat('Something else entirely')
    const [hit, ...rest] = store.searchConversations('pango')
    expect(rest).toEqual([])
    expect(hit).toMatchObject({ id: a })
    expect(hit!.snippet).toContain('pangolins')
    expect(ids(store.searchConversations('roll up'))).toEqual([a])
  })

  it('searches titles', () => {
    const a = chat('hi', 'hello', 'Trip to Lisbon')
    expect(ids(store.searchConversations('lisb'))).toEqual([a])
    expect(store.searchConversations('lisb')[0]!.snippet).toBeUndefined()
  })

  it('treats search operators as plain text', () => {
    chat('a OR b NEAR c "quoted" -minus')
    expect(() => store.searchConversations('" OR NEAR( -* %_')).not.toThrow()
    expect(store.searchConversations('   ')).toEqual([])
  })

  it('keeps temporary chats out of lists and search, and sweeps them', () => {
    const { id } = store.createConversation({ temporary: true })
    store.appendItems(id, null, [{ role: 'user', content: 'secret walrus' }])
    expect(store.getConversation(id)!.temporary).toBe(true)
    expect(store.listConversations()).toEqual([])
    expect(store.searchConversations('walrus')).toEqual([])

    const kept = chat('kept')
    expect(store.deleteTemporaryConversations()).toBe(1)
    expect(store.getConversation(id)).toBeUndefined()
    expect(store.getConversation(kept)).toBeDefined()
  })

  it('migrates a version-1 database and indexes its messages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chibot-'))
    try {
      const file = join(dir, 'v1.db')
      const v1 = new DatabaseSync(file)
      v1.exec(`
        CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT,
          current_leaf_id INTEGER, created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL);
        CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          parent_id INTEGER REFERENCES items(id), data TEXT NOT NULL,
          usage TEXT, created_at INTEGER NOT NULL);
        INSERT INTO conversations VALUES ('old', NULL, 1, 0, 0);
        INSERT INTO items VALUES (1, 'old', NULL,
          '{"role":"user","content":"ancient axolotl"}', NULL, 0);
        PRAGMA user_version = 1;`)
      v1.close()

      const migrated = new ConversationStore(file)
      expect(migrated.getConversation('old')).toMatchObject({
        pinned: false,
        archived: false,
        temporary: false,
      })
      expect(ids(migrated.searchConversations('axolotl'))).toEqual(['old'])
      migrated.close()
    } finally {
      rmSync(dir, { recursive: true })
    }
  })
})
