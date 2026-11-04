import { beforeEach, describe, expect, it } from 'vitest'
import { ConversationSearch } from '../../src/server/conversations/index.ts'
import type { ConversationStore } from '../../src/server/conversations/index.ts'
import { openDatabase } from '../../src/server/database.ts'
import { SearchChatsTool } from '../../src/server/tools/search-chats.ts'
import { ProjectStore } from '../../src/server/projects/index.ts'
import { memoryStore, testFiles } from './fakes.ts'

describe('SearchChatsTool', () => {
  let store: ConversationStore
  let searchChats: SearchChatsTool
  let projects: ProjectStore
  let current: string
  const chat = (title: string, messages: string[], temporary = false) => {
    const { id } = store.createConversation({ temporary })
    store.updateConversation(id, { title })
    let parent: number | null = null
    for (const [i, content] of messages.entries()) {
      parent = store.appendItems(id, parent, [
        { role: i % 2 ? 'assistant' : 'user', content },
      ])[0]!.id
    }
    return id
  }
  beforeEach(() => {
    const db = openDatabase(':memory:')
    store = memoryStore(db)
    projects = new ProjectStore(db, testFiles(db))
    searchChats = new SearchChatsTool(new ConversationSearch(db))
    chat('Pasta', ['A quick pasta recipe?', 'Boil spaghetti for nine minutes.'])
    chat('Schema', [
      'How should we store chats?',
      'We decided the database schema keeps items as a tree.',
    ])
    chat('Secret', ['database schema notes'], true)
    current = chat('Now', ['What did we decide about the database schema?'])
  })

  const search = async (args: {
    query: string
    after?: string | null
    before?: string | null
  }) =>
    JSON.parse(
      await searchChats.run(
        { after: null, before: null, ...args },
        { conversationId: current },
      ),
    ) as {
      results: {
        title: string
        messages: { role: string; excerpt: string; date: string }[]
      }[]
    }

  it('finds the best matching chat for a natural question', async () => {
    const { results } = await search({
      query: 'what did we decide about the database schema last week',
    })
    // The question and its answer, in order.
    expect(results[0]).toEqual({
      chat_id: expect.any(String),
      title: 'Schema',
      messages: [
        {
          role: 'user',
          date: new Date().toLocaleDateString('sv'),
          excerpt: 'How should we store chats?',
        },
        {
          role: 'assistant',
          date: new Date().toLocaleDateString('sv'),
          excerpt: 'We decided the database schema keeps items as a tree.',
        },
      ],
    })
    // Neither the chat asking nor a temporary chat is searched.
    expect(results.map((r) => r.title)).toEqual(['Schema'])
  })

  it("searches only the project's chats from a project chat", async () => {
    const project = projects.create('P').id
    const inProject = chat('Schema in project', ['database schema in project'])
    store.updateConversation(inProject, { projectId: project })
    const asking = chat('Asking', ['hello'])
    store.updateConversation(asking, { projectId: project })

    const run = async (projectId: string | null) =>
      (
        JSON.parse(
          await searchChats.run(
            { query: 'database schema', after: null, before: null },
            { conversationId: asking, projectId },
          ),
        ) as { results: { title: string }[] }
      ).results.map((r) => r.title)
    expect(await run(project)).toEqual(['Schema in project'])
    expect(await run(null)).toContain('Schema')
  })

  it('counts as untrusted, so a memory saved after it asks first', () => {
    // Old chats hold whatever was pasted or fetched in them.
    expect(searchChats.untrustedOutput).toBe(true)
  })

  it('limits by date', async () => {
    const today = new Date()
    const day = (offset: number) =>
      new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + offset,
      ).toLocaleDateString('sv') // YYYY-MM-DD
    expect((await search({ query: 'pasta', after: day(1) })).results).toEqual(
      [],
    )
    expect(
      (await search({ query: 'pasta', before: day(1) })).results,
    ).toHaveLength(1)
    await expect(
      search({ query: 'pasta', after: 'last week' }),
    ).rejects.toThrow('not a YYYY-MM-DD date')
    // Not rolled over into March, and not read as a time of day.
    for (const bad of ['2026-02-31', '2026-1-5', '2026-10-27T10:00']) {
      await expect(search({ query: 'pasta', after: bad })).rejects.toThrow(
        'not a YYYY-MM-DD date',
      )
    }
    // Models send "" for "no date".
    expect(
      (await search({ query: 'pasta', after: '', before: ' ' })).results,
    ).toHaveLength(1)
  })
})
