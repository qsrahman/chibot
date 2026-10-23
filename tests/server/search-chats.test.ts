import { beforeEach, describe, expect, it } from 'vitest'
import type { ConversationStore } from '../../src/server/conversation-store.ts'
import { SearchChatsTool } from '../../src/server/tools/search-chats.ts'
import { memoryStore } from './fakes.ts'

describe('SearchChatsTool', () => {
  let store: ConversationStore
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
    store = memoryStore()
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
      await new SearchChatsTool(store).run(
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
  })
})
