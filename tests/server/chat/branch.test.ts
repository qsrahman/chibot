import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../src/server/database.ts'
import type { ConversationStore } from '../../../src/server/conversations/index.ts'
import type { FileStore } from '../../../src/server/file-store.ts'
import { ProjectStore } from '../../../src/server/projects/index.ts'
import type { Conversation } from '../../../src/shared/types.ts'
import { memoryStore, testApp, testFiles } from '../fakes.ts'

describe('branching a chat', () => {
  let store: ConversationStore
  let files: FileStore
  let projects: ProjectStore
  let app: ReturnType<typeof testApp>
  beforeEach(() => {
    const db = openDatabase(':memory:')
    store = memoryStore(db)
    files = testFiles(db)
    projects = new ProjectStore(db, files)
    app = testApp({ store, files, projects })
  })

  const branch = (id: string, itemId: number) =>
    app.request(`/api/conversations/${id}/branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    })

  /** q1 (with a photo) → a1 (a drawing) → q2 → a2, in a titled chat. */
  function chat() {
    const { id } = store.createConversation()
    const photo = files.save(id, 'cat.png', 'image/png', Buffer.from('CAT'))
    const drawn = files.save(id, 'image.webp', 'image/webp', Buffer.from('ART'))
    const unused = files.save(
      id,
      'later.png',
      'image/png',
      Buffer.from('LATER'),
    )
    const q1 = store.appendItems(id, null, [
      {
        role: 'user',
        content: [
          { type: 'input_image', file_id: photo.id, detail: 'auto' },
          { type: 'input_text', text: 'Draw it' },
        ],
      },
    ])
    const a1 = store.appendItems(
      id,
      q1[0]!.id,
      [
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
        { role: 'assistant', content: 'Here it is' },
      ],
      { input_tokens: 100, output_tokens: 20, total_tokens: 120 } as never,
      'm',
    )
    const q2 = store.appendItems(id, a1.at(-1)!.id, [
      {
        role: 'user',
        content: `Now in blue ${unused.id}`,
      },
    ])
    const a2 = store.appendItems(id, q2[0]!.id, [
      { role: 'assistant', content: 'Blue it is' },
    ])
    store.updateConversation(id, { title: 'Cats' })
    return { id, q1, a1, q2, a2, photo, drawn, unused }
  }

  const texts = (id: string) =>
    store
      .getPath(id)
      .map((item) =>
        'content' in item.data
          ? JSON.stringify(item.data.content)
          : item.data.type,
      )

  it('copies the chat up to the end of the turn, into a new chat on top', async () => {
    const { id, q1 } = chat()
    // Any message of the turn will do; the first turn ends at its answer.
    const res = await branch(id, q1[0]!.id)
    expect(res.status).toBe(201)
    const created = (await res.json()) as Conversation
    expect(created.id).not.toBe(id)
    expect(created.title).toBe('Branch · Cats')
    const copy = store.getPath(created.id)
    expect(copy).toHaveLength(4) // q1, the call, its output, a1
    expect(JSON.stringify(copy.at(-1)!.data)).toContain('Here it is')
    expect(copy.at(-1)).toMatchObject({
      usage: { input_tokens: 100 },
      model: 'm',
    })
    expect(created.currentLeafId).toBe(copy.at(-1)!.id)
    // The original is untouched, and the copy is the newest chat.
    expect(store.getPath(id)).toHaveLength(6)
    expect(created.updatedAt).toBeGreaterThanOrEqual(
      store.getConversation(id)!.updatedAt,
    )
    // New messages continue from the copy alone.
    store.appendItems(created.id, created.currentLeafId, [
      { role: 'user', content: 'Something else' },
    ])
    expect(store.getPath(id)).toHaveLength(6)
  })

  it('branches after the last turn too, and copies the files the messages use', async () => {
    const { id, a2, photo, drawn, unused } = chat()
    const res = await branch(id, a2[0]!.id)
    const created = (await res.json()) as Conversation
    expect(store.getPath(created.id)).toHaveLength(6)
    const copied = files.ofConversation(created.id)
    // The photo and the drawing are copied under new ids; the file that only
    // appears in a message's text is not a use of it.
    expect(copied.map((f) => f.name).sort()).toEqual(['cat.png', 'image.webp'])
    expect(copied.map((f) => f.id)).not.toContain(photo.id)
    expect(copied.map((f) => f.id)).not.toContain(drawn.id)
    expect(texts(created.id).join('')).not.toContain(photo.id)
    expect(texts(created.id).join('')).not.toContain(drawn.id)
    const bytes = copied.map((f) => files.read(f.id).toString()).sort()
    expect(bytes).toEqual(['ART', 'CAT'])
    expect(unused.id).toBeTruthy()
    // Deleting the original leaves the branch whole.
    store.deleteConversation(id)
    files.deleteOrphans()
    for (const f of copied) expect(files.read(f.id)).toBeTruthy()
  })

  it('keeps the summaries that apply, and the project', async () => {
    const { id, q1, a1, q2 } = chat()
    const project = projects.create('P')
    store.updateConversation(id, { projectId: project.id })
    const first = store.compactions.add(id, {
      upToItemId: q1[0]!.id,
      summary: 'S1',
      summaryModel: 'm',
      tokensBefore: 50,
      tokensAfter: 10,
      previousId: null,
      degraded: false,
    })
    store.compactions.add(id, {
      upToItemId: a1.at(-1)!.id,
      summary: 'S2',
      summaryModel: 'm',
      tokensBefore: 60,
      tokensAfter: 12,
      previousId: first.id,
      degraded: true,
    })
    // A summary that covers a later part is left behind.
    store.compactions.add(id, {
      upToItemId: q2[0]!.id,
      summary: 'LATER',
      summaryModel: 'm',
      tokensBefore: 70,
      tokensAfter: 14,
      previousId: null,
      degraded: false,
    })
    const created = (await (await branch(id, q1[0]!.id)).json()) as Conversation
    expect(created.projectId).toBe(project.id)
    const copy = store.getPath(created.id)
    const summaries = store.compactions.list(created.id)
    expect(summaries.map((s) => s.summary)).toEqual(['S1', 'S2'])
    expect(summaries[0]!.upToItemId).toBe(copy[0]!.id)
    expect(summaries[1]).toMatchObject({
      upToItemId: copy.at(-1)!.id,
      previousId: summaries[0]!.id,
      degraded: true,
    })
  })

  it('refuses what cannot be branched', async () => {
    const { id, a1 } = chat()
    expect((await branch('nope', 1)).status).toBe(404)
    expect((await branch(id, 99999)).status).toBe(404)
    const temp = store.createConversation({ temporary: true })
    const t = store.appendItems(temp.id, null, [{ role: 'user', content: 'x' }])
    expect((await branch(temp.id, t[0]!.id)).status).toBe(409)
    // An answer waiting for a tool to be approved.
    const waiting = store.appendItems(id, a1.at(-1)!.id, [
      { role: 'user', content: 'Search' },
      { type: 'function_call', call_id: 'w', name: 'memory', arguments: '{}' },
    ])
    expect((await branch(id, waiting[0]!.id)).status).toBe(409)
  })
})
