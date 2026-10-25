import { describe, expect, it } from 'vitest'
import { ChatService } from '../../src/server/chat-service.ts'
import { Config } from '../../src/server/config.ts'
import type { Memory } from '../../src/shared/types.ts'
import {
  fakeClient,
  memoryStore,
  testMemories,
  testSettings,
  testApp,
} from './fakes.ts'

describe('MemoryStore', () => {
  it('saves, updates, lists and deletes memories', () => {
    const memories = testMemories()
    const a = memories.save('Prefers Rust.')
    const b = memories.save('Lives in Lahore.')
    expect(memories.update(a.id, 'Prefers Go now.')).toMatchObject({
      id: a.id,
      text: 'Prefers Go now.',
    })
    expect(memories.update(999, 'x')).toBeNull()
    expect(memories.list().map((m) => m.text)).toEqual([
      'Prefers Go now.',
      'Lives in Lahore.',
    ])
    expect(memories.count).toBe(2)
    expect(memories.delete(b.id)).toBe(true)
    expect(memories.delete(b.id)).toBe(false)
    memories.clear()
    expect(memories.list()).toEqual([])
  })

  it('keeps a memory on one line', () => {
    const memories = testMemories()
    expect(memories.save('  Prefers\nRust.\tA lot. ').text).toBe(
      'Prefers Rust. A lot.',
    )
    const saved = memories.list()[0]!
    expect(memories.update(saved.id, 'Prefers\r\nGo.')?.text).toBe(
      'Prefers Go.',
    )
    const rust = memories.save('Prefers Rust.')
    expect(memories.find('  prefers   RUST. ')?.id).toBe(rust.id)
    expect(memories.find('Lives in Lahore.')).toBeNull()
  })

  it('is served, edited and deleted through the API', async () => {
    const memories = testMemories()
    const store = memoryStore()
    const settings = testSettings()
    const app = testApp({
      config: new Config({ OPENAI_API_KEY: 'k' }),
      store,
      settings,
      chat: new ChatService(fakeClient([]), store, settings),
      memories,
    })
    const first = memories.save('First.')
    memories.save('Second.')
    const patch = (id: number | string, body: unknown) =>
      app.request(`/api/memories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    const listed = (await (
      await app.request('/api/memories')
    ).json()) as Memory[]
    expect(listed.map((m) => m.text)).toEqual(['Second.', 'First.'])

    const edited = await patch(first.id, { text: ' First, edited. ' })
    expect(edited.status).toBe(200)
    expect(await edited.json()).toMatchObject({
      id: first.id,
      text: 'First, edited.',
    })
    expect((await patch(first.id, { text: ' ' })).status).toBe(400)
    expect((await patch(first.id, { text: 'x'.repeat(301) })).status).toBe(400)
    expect((await patch(999, { text: 'Other.' })).status).toBe(404)
    expect((await patch('x', { text: 'Other.' })).status).toBe(404)
    expect((await patch(first.id, { text: 'second.' })).status).toBe(409)

    const del = (path: string) => app.request(path, { method: 'DELETE' })
    expect((await del(`/api/memories/${first.id}`)).status).toBe(204)
    expect((await del(`/api/memories/${first.id}`)).status).toBe(404)
    expect((await del('/api/memories/x')).status).toBe(404)
    expect((await del('/api/memories')).status).toBe(204)
    expect(memories.count).toBe(0)
  })
})
