import { beforeEach, describe, expect, it } from 'vitest'
import { ChatService } from '../../src/server/chat-service.ts'
import { Config } from '../../src/server/config.ts'
import type { ConversationStore } from '../../src/server/conversation-store.ts'
import { openDatabase } from '../../src/server/database.ts'
import type { FileStore } from '../../src/server/file-store.ts'
import type { ConversationExport } from '../../src/shared/export.ts'
import type { Conversation } from '../../src/shared/types.ts'
import {
  fakeClient,
  memoryStore,
  testFiles,
  testSettings,
  usage,
  testApp,
} from './fakes.ts'

describe('export and import', () => {
  let store: ConversationStore
  let files: FileStore
  let app: ReturnType<typeof testApp>
  beforeEach(() => {
    const db = openDatabase(':memory:')
    store = memoryStore(db)
    files = testFiles(db)
    const settings = testSettings()
    app = testApp({
      config: new Config({ OPENAI_API_KEY: 'k' }),
      store,
      files,
      settings,
      chat: new ChatService(fakeClient([]), store, settings),
    })
  })

  /** q1 → (a1 | a2 regenerated, shown) → q2 → a3, titled. */
  function sampleChat(): string {
    const { id } = store.createConversation()
    const [q1] = store.appendItems(id, null, [{ role: 'user', content: 'q1' }])
    store.appendItems(
      id,
      q1!.id,
      [{ role: 'assistant', content: 'a1' }],
      usage,
      'm-old',
    )
    const [a2] = store.appendItems(
      id,
      q1!.id,
      [{ role: 'assistant', content: 'a2' }],
      usage,
      'm-new',
    )
    const [q2] = store.appendItems(id, a2!.id, [
      { role: 'user', content: 'q2' },
    ])
    store.appendItems(
      id,
      q2!.id,
      [{ role: 'assistant', content: 'a3' }],
      null,
      'm-new',
    )
    store.updateConversation(id, { title: 'Sample · ünïcode' })
    return id
  }

  const exportJson = async (id: string) => {
    const res = await app.request(`/api/conversations/${id}/export`)
    return { res, body: (await res.json()) as ConversationExport }
  }
  const importJson = (body: unknown) =>
    app.request('/api/conversations/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('exports the full tree as a JSON download', async () => {
    const { res, body } = await exportJson(sampleChat())
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('Sample · ünïcode.json')}`,
    )
    expect(body.version).toBe(2)
    expect(body.files).toEqual([])
    expect(body.items.map((i) => i.data)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a3' },
    ])
  })

  it('round-trips through import unchanged', async () => {
    const original = (await exportJson(sampleChat())).body
    const res = await importJson(original)
    expect(res.status).toBe(201)
    const imported = (await res.json()) as Conversation
    expect(imported).toMatchObject({
      title: 'Sample · ünïcode',
      pinned: false,
      archived: false,
      temporary: false,
    })

    const again = (await exportJson(imported.id)).body
    // Ids are new; everything else, including which version is shown,
    // matches once ids are compared by position.
    const position = (items: ConversationExport['items'], id: number | null) =>
      id === null ? null : items.findIndex((i) => i.id === id)
    const shape = (e: ConversationExport) => ({
      conversation: e.conversation,
      leaf: position(e.items, e.currentLeafId),
      items: e.items.map((i) => ({
        ...i,
        id: position(e.items, i.id),
        parentId: position(e.items, i.parentId),
      })),
    })
    expect(shape(again)).toEqual(shape(original))
    expect(store.getPath(imported.id).map((i) => i.model)).toEqual([
      null,
      'm-new',
      null,
      'm-new',
    ])
  })

  it('exports what is shown as Markdown', async () => {
    const res = await app.request(
      `/api/conversations/${sampleChat()}/export?format=md`,
    )
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(await res.text()).toBe(
      '# Sample · ünïcode\n\n## You\n\nq1\n\n## Assistant (m-new)\n\na2\n\n' +
        '## You\n\nq2\n\n## Assistant (m-new)\n\na3\n',
    )
  })

  it('quotes tool calls with their results in Markdown', async () => {
    const { id } = store.createConversation()
    const [q] = store.appendItems(id, null, [{ role: 'user', content: 'q' }])
    store.appendItems(id, q!.id, [
      {
        type: 'function_call',
        call_id: 'c1',
        name: 'calculator',
        arguments: '{"expression":"1+1"}',
      },
      { type: 'function_call_output', call_id: 'c1', output: '2\nexactly' },
      { role: 'assistant', content: 'Two.' },
    ])
    const res = await app.request(`/api/conversations/${id}/export?format=md`)
    expect(await res.text()).toBe(
      '# Chat\n\n## You\n\nq\n\n' +
        '> Used **calculator** with `{"expression":"1+1"}`:\n>\n> 2\n> exactly\n\n' +
        '## Assistant\n\nTwo.\n',
    )
  })

  it('rejects malformed files', async () => {
    const good = (await exportJson(sampleChat())).body
    const broken = [
      { ...good, version: 3 },
      { ...good, files: [{ id: 'not-a-uuid', name: 'a.png', data: '' }] },
      { ...good, currentLeafId: 9999 },
      { ...good, items: [...good.items].reverse() }, // children before parents
      { ...good, items: [{ ...good.items[0]!, data: { nope: 1 } }] },
    ]
    for (const body of broken) {
      const res = await importJson(body)
      expect(res.status).toBe(400)
    }
    expect((await app.request('/api/conversations/nope/export')).status).toBe(
      404,
    )
  })

  /** A question with an attached photo and file, answered with an image. */
  function chatWithFiles() {
    const { id } = store.createConversation()
    const photo = files.save(id, 'cat.png', 'image/png', Buffer.from('PNG'))
    const notes = files.save(id, 'notes.md', 'text/markdown', Buffer.from('#'))
    const drawn = files.save(id, 'image.webp', 'image/webp', Buffer.from('W'))
    const [q] = store.appendItems(id, null, [
      {
        role: 'user',
        content: [
          { type: 'input_image', file_id: photo.id, detail: 'auto' },
          { type: 'input_file', file_id: notes.id, filename: 'notes.md' },
          { type: 'input_text', text: 'Draw it' },
        ],
      },
    ])
    store.appendItems(id, q!.id, [
      {
        type: 'function_call',
        call_id: 'c1',
        name: 'generate_image',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'c1',
        output: JSON.stringify({ image_id: drawn.id }),
      },
    ])
    return id
  }

  it('embeds files, and imports them under new ids', async () => {
    const original = (await exportJson(chatWithFiles())).body
    expect(original.files.map(({ name, data }) => [name, data])).toEqual([
      ['cat.png', Buffer.from('PNG').toString('base64')],
      ['notes.md', Buffer.from('#').toString('base64')],
      ['image.webp', Buffer.from('W').toString('base64')],
    ])

    const imported = (await (await importJson(original)).json()) as Conversation
    const copies = files.ofConversation(imported.id)
    expect(copies.map(({ name, mime }) => [name, mime])).toEqual([
      ['cat.png', 'image/png'],
      ['notes.md', 'text/markdown'],
      ['image.webp', 'image/webp'],
    ])
    expect(files.read(copies[0]!.id).toString()).toBe('PNG')
    // The items point at the copies, not the originals.
    const [question, , output] = store.getPath(imported.id)
    expect(question!.data).toMatchObject({
      content: [{ file_id: copies[0]!.id }, { file_id: copies[1]!.id }, {}],
    })
    expect(output!.data).toMatchObject({
      output: JSON.stringify({ image_id: copies[2]!.id }),
    })
  })

  it('still imports version 1 files', async () => {
    const { files: _, ...v1 } = (await exportJson(sampleChat())).body
    const res = await importJson({ ...v1, version: 1 })
    expect(res.status).toBe(201)
  })

  it('lists attachments in Markdown', async () => {
    const res = await app.request(
      `/api/conversations/${chatWithFiles()}/export?format=md`,
    )
    expect(await res.text()).toContain(
      '## You\n\n*Attached: cat.png, notes.md*\n\nDraw it',
    )
  })
})
