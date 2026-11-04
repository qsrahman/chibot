import { beforeEach, describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import type { ResponseFunctionToolCall } from 'openai/resources/responses/responses'
import type { ConversationStore } from '../../../src/server/conversations/index.ts'
import { openDatabase } from '../../../src/server/database.ts'
import type { FileStore } from '../../../src/server/file-store.ts'
import { ProjectIndex } from '../../../src/server/projects/project-index.ts'
import { ProjectStore } from '../../../src/server/projects/project-store.ts'
import {
  TOOL_STOPPED,
  ToolRegistry,
} from '../../../src/server/tool-registry.ts'
import { SearchProjectFilesTool } from '../../../src/server/projects/search-files.ts'
import { ReadProjectFileTool } from '../../../src/server/projects/read-file.ts'
import {
  answerEvents,
  drain,
  memoryStore,
  testFiles,
  type FakeCall,
  testChat,
} from '../fakes.ts'

/**
 * "Embeddings" that put texts about travel and about food on two axes, so
 * a search can find a passage by meaning without sharing its words.
 */
const TOPICS = [/train|trip|travel|kyoto|journey/i, /food|eat|ramen|dinner/i]
const fakeEmbeddings = {
  embeddings: {
    create: async ({ input }: { input: string[] }) => ({
      data: input.map((text, index) => ({
        index,
        embedding: TOPICS.map((topic) => (topic.test(text) ? 1 : 0.01)),
      })),
    }),
  },
} as unknown as OpenAI

describe('project file search', () => {
  let db: ReturnType<typeof openDatabase>
  let store: ConversationStore
  let files: FileStore
  let projects: ProjectStore
  let index: ProjectIndex
  let projectId: string
  beforeEach(() => {
    db = openDatabase(':memory:')
    store = memoryStore(db)
    files = testFiles(db)
    projects = new ProjectStore(db, files)
    index = new ProjectIndex(db, projects, files, {
      client: fakeEmbeddings,
      model: () => 'emb',
    })
    projectId = projects.create('Japan').id
  })

  async function add(name: string, text: string, project = projectId) {
    const file = files.save(null, name, 'text/plain', Buffer.from(text))
    projects.addFile(project, file.id)
    await index.index(file.id)
  }

  it('lists at most 50 file names in the instructions', async () => {
    const tool = new SearchProjectFilesTool(projects, index)
    const chat = store.createConversation({ projectId })
    for (let n = 1; n <= 53; n++) await add(`f${n}.md`, `Note ${n}.`)
    const text = tool.instructions(chat)!
    expect(text).toContain('f50.md, and 3 more.')
    expect(text).not.toContain('f51.md')
  })

  it('finds passages by keyword and by meaning', async () => {
    await add('codes.md', 'The door code is KESTREL.')
    await add('plan.md', 'Take the shinkansen to Kyoto on day two.')
    await add('meals.md', 'Ramen in Osaka.')
    await add(
      'other.md',
      'A train to Kyoto, in another project.',
      projects.create('X').id,
    )

    expect((await index.search(projectId, 'kestrel'))[0]).toMatchObject({
      name: 'codes.md',
      text: 'The door code is KESTREL.',
    })
    // No shared word: found by its meaning (the travel axis).
    const journey = await index.search(projectId, 'how do we travel?')
    expect(journey[0]!.name).toBe('plan.md')
    expect(journey.map((r) => r.name)).not.toContain('other.md')
  })

  it('limits a search to one file, by keyword and by meaning', async () => {
    await add('plan.md', 'Take the shinkansen to Kyoto on day two.')
    await add('trip.md', 'A train trip to Kyoto, then Osaka.')
    const trip = projects.fileNamed(projectId, 'TRIP.md')!
    for (const query of ['kyoto', 'how do we travel?']) {
      const hits = await index.search(projectId, query, { fileId: trip.fileId })
      expect(hits.map((h) => h.name)).toEqual(['trip.md'])
    }
  })

  it('returns as many passages as asked for, within limits', async () => {
    for (let n = 1; n <= 20; n++)
      await add(`f${n}.md`, `Note about otters ${n}.`)
    const count = async (limit?: number) =>
      (await index.search(projectId, 'otters', { limit })).length
    expect(await count()).toBe(6)
    expect(await count(2)).toBe(2)
    expect(await count(12)).toBe(12)
    expect(await count(100)).toBe(15)
    expect(await count(0)).toBe(1)
  })

  it('says which part of how many a passage is, and reads the parts in order', async () => {
    const tool = new SearchProjectFilesTool(projects, index)
    const reader = new ReadProjectFileTool(projects, index)
    const paragraph = (n: number) => `Section ${n}. ${'word '.repeat(300)}`
    await add('long.md', [1, 2, 3, 4, 5, 6, 7].map(paragraph).join('\n\n'))
    const context = { conversationId: 'c', projectId }

    const found = JSON.parse(
      await tool.run(
        { query: 'Section 5', file: 'long.md', limit: null },
        context,
      ),
    )
    expect(found.results[0]).toMatchObject({ file: 'long.md', parts: 4 })

    const first = JSON.parse(
      await reader.run({ file: 'LONG.md', from_part: null }, context),
    )
    expect(first).toMatchObject({ file: 'long.md', parts: 4, from: 1, to: 3 })
    expect(first.text).toContain('Section 1.')
    expect(first.text).not.toContain('Section 7.')
    const last = JSON.parse(
      await reader.run({ file: 'long.md', from_part: 4 }, context),
    )
    expect(last).toMatchObject({ from: 4, to: 4 })
    expect(last.text).toContain('Section 7.')
  })

  it("names the project's files when asked for one it does not have", async () => {
    await add('plan.md', 'Kyoto.')
    const reader = new ReadProjectFileTool(projects, index)
    await expect(
      reader.run(
        { file: 'nope.md', from_part: null },
        { conversationId: 'c', projectId },
      ),
    ).rejects.toThrow('its files are: plan.md')
  })

  it('is offered in project chats with files, with their names', async () => {
    const tool = new SearchProjectFilesTool(projects, index)
    const chat = store.createConversation({ projectId })
    expect(tool.offeredIn(chat)).toBe(false)
    await add('plan.md', 'Kyoto.')
    expect(tool.offeredIn(chat)).toBe(true)
    expect(tool.offeredIn(store.createConversation())).toBe(false)
    expect(tool.instructions(chat)).toContain('read_project_file: plan.md')

    const output = JSON.parse(
      await tool.run(
        { query: 'Kyoto', file: null, limit: null },
        { conversationId: chat.id, projectId },
      ),
    )
    expect(output.results).toEqual([
      {
        file: 'plan.md',
        file_id: expect.any(String),
        part: 1,
        parts: 1,
        text: 'Kyoto.',
      },
    ])
  })

  it('stops a search whose embedding is still running', async () => {
    await add('plan.md', 'Take the shinkansen to Kyoto.')
    const hanging = {
      embeddings: {
        create: (_params: unknown, { signal }: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal!.addEventListener('abort', () => reject(signal!.reason))
            // Cancel from inside the request: it's certainly in flight.
            stop.abort()
          }),
      },
    } as unknown as OpenAI
    const slow = new ProjectIndex(db, projects, files, {
      client: hanging,
      model: () => 'emb',
    })
    const registry = new ToolRegistry([
      new SearchProjectFilesTool(projects, slow),
    ])
    const stop = new AbortController()
    const call: ResponseFunctionToolCall = {
      type: 'function_call',
      call_id: 'call_1',
      name: 'search_project_files',
      arguments: '{"query":"kyoto","file":null,"limit":null}',
    }

    const run = registry.run(call, {
      conversationId: 'chat-1',
      projectId,
      signal: stop.signal,
    })
    expect(await run).toBe(TOOL_STOPPED)
  })

  it('gives project chats the project instructions and the tool', async () => {
    projects.update(projectId, { instructions: 'Prices in yen.' })
    await add('plan.md', 'Kyoto.')
    const calls: FakeCall[] = []
    const chat = testChat(answerEvents('ok'), {
      store,
      calls,
      tools: new ToolRegistry([
        new SearchProjectFilesTool(projects, index),
        new ReadProjectFileTool(projects, index),
      ]),
      projects: projects,
    })
    const { id } = store.createConversation({ projectId })
    await drain(chat.runTurn(id, { text: 'Hi' }))

    const { instructions, tools } = calls[0]!.params
    expect(instructions).toContain(
      '<project name="Japan">\nPrices in yen.\n</project>',
    )
    expect(instructions).toContain('Prices in yen.')
    expect(tools).toEqual([
      expect.objectContaining({ name: 'search_project_files' }),
      expect.objectContaining({ name: 'read_project_file' }),
    ])

    const loose = store.createConversation()
    await drain(chat.runTurn(loose.id, { text: 'Hi' }))
    expect(calls[1]!.params.instructions).not.toContain('Japan')
    expect(calls[1]!.params).not.toHaveProperty('tools')
  })
})
