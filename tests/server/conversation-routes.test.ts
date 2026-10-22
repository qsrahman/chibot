import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app.ts'
import { ChatService } from '../../src/server/chat-service.ts'
import { Config } from '../../src/server/config.ts'
import { ConversationStore } from '../../src/server/conversation-store.ts'
import type {
  Conversation,
  ConversationListItem,
} from '../../src/shared/types.ts'
import { fakeClient } from './fakes.ts'

const config = new Config({ OPENAI_API_KEY: 'k' })

describe('conversation routes', () => {
  let store: ConversationStore
  let app: ReturnType<typeof createApp>
  beforeEach(() => {
    store = new ConversationStore(':memory:')
    app = createApp({
      config,
      store,
      chat: new ChatService(fakeClient([]), store, 'm'),
    })
  })
  afterEach(() => store.close())

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
})
