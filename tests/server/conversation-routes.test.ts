import { beforeEach, describe, expect, it } from 'vitest'
import { ChatService } from '../../src/server/chat-service.ts'
import { Config } from '../../src/server/config.ts'
import { ConversationStore } from '../../src/server/conversation-store.ts'
import type {
  Conversation,
  ConversationListItem,
} from '../../src/shared/types.ts'
import { openDatabase } from '../../src/server/database.ts'
import type { FileStore } from '../../src/server/file-store.ts'
import {
  fakeClient,
  memoryStore,
  testFiles,
  testSettings,
  testApp,
} from './fakes.ts'

const config = new Config({ OPENAI_API_KEY: 'k' })

describe('conversation routes', () => {
  let store: ConversationStore
  let files: FileStore
  let app: ReturnType<typeof testApp>
  beforeEach(() => {
    const db = openDatabase(':memory:')
    store = memoryStore(db)
    files = testFiles(db)
    const settings = testSettings('m')
    app = testApp({
      config,
      store,
      settings,
      chat: new ChatService(fakeClient([]), store, settings),
      files,
    })
  })

  const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  async function list(query = ''): Promise<ConversationListItem[]> {
    const res = await app.request(`/api/conversations${query}`)
    return (await res.json()) as ConversationListItem[]
  }

  function saved(text: string): string {
    const { id } = store.createConversation()
    store.appendItems(id, null, [{ role: 'user', content: text }])
    return id
  }

  it('creates saved and temporary conversations', async () => {
    const plain = (await (
      await app.request('/api/conversations', { method: 'POST' })
    ).json()) as Conversation
    const temp = (await (
      await app.request('/api/conversations', json('POST', { temporary: true }))
    ).json()) as Conversation
    expect(plain.temporary).toBe(false)
    expect(temp.temporary).toBe(true)
    expect((await list()).map((c) => c.id)).toEqual([plain.id])
  })

  it('rejects a malformed create body', async () => {
    const res = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
  })

  it('lists, searches and shows the archive', async () => {
    const a = saved('walrus facts')
    const b = saved('otter facts')
    store.updateConversation(b, { archived: true })

    expect((await list()).map((c) => c.id)).toEqual([a])
    expect((await list('?archived=1')).map((c) => c.id)).toEqual([b])
    const hits = await list('?q=walr')
    expect(hits.map((c) => c.id)).toEqual([a])
    expect(hits[0]!.snippet).toContain('walrus')
  })

  it('has the model name a chat again', async () => {
    const id = saved('Tell me about pangolins')
    store.updateConversation(id, { title: 'Old' })
    const res = await app.request(`/api/conversations/${id}/title`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    // fakeClient's title request answers "Test Title".
    expect(await res.json()).toEqual({ title: 'Test Title' })
    expect(store.getConversation(id)!.title).toBe('Test Title')
  })

  it('has no title to regenerate for empty, temporary or missing chats', async () => {
    const post = (id: string) =>
      app.request(`/api/conversations/${id}/title`, { method: 'POST' })
    expect((await post(store.createConversation().id)).status).toBe(400)
    expect(
      (await post(store.createConversation({ temporary: true }).id)).status,
    ).toBe(400)
    expect((await post('nope')).status).toBe(404)
  })

  it('renames, pins and archives', async () => {
    const id = saved('hi')
    const res = await app.request(
      `/api/conversations/${id}`,
      json('PATCH', { title: '  New name  ', pinned: true, archived: true }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      id,
      title: 'New name',
      pinned: true,
      archived: true,
    })
  })

  it('validates patches', async () => {
    const id = saved('hi')
    for (const body of [{ title: ' ' }, { title: 3 }, { pinned: 'yes' }]) {
      const res = await app.request(
        `/api/conversations/${id}`,
        json('PATCH', body),
      )
      expect(res.status).toBe(400)
    }
    const missing = await app.request(
      '/api/conversations/nope',
      json('PATCH', { pinned: true }),
    )
    expect(missing.status).toBe(404)
  })

  it('deletes', async () => {
    const id = saved('hi')
    expect(
      (await app.request(`/api/conversations/${id}`, { method: 'DELETE' }))
        .status,
    ).toBe(204)
    expect(
      (await app.request(`/api/conversations/${id}`, { method: 'DELETE' }))
        .status,
    ).toBe(404)
  })

  it("serves a chat's files and deletes them with it", async () => {
    const id = saved('hi')
    const other = saved('other')
    const png = new Uint8Array([137, 80, 78, 71])
    const file = files.save(id, 'robot (1).png', 'image/png', png)
    const kept = files.save(other, 'kept.png', 'image/png', png)

    const res = await app.request(`/api/files/${file.id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-disposition')).toBe(
      "inline; filename*=UTF-8''robot%20(1).png",
    )
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png)
    expect((await app.request('/api/files/nope')).status).toBe(404)

    await app.request(`/api/conversations/${id}`, { method: 'DELETE' })
    expect(files.get(file.id)).toBeNull()
    expect(() => files.read(file.id)).toThrow(/ENOENT/)
    expect(files.read(kept.id)).toEqual(Buffer.from(png))
  })
})
