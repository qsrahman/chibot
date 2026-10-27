import { beforeEach, describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import type { ResponseFunctionToolCall } from 'openai/resources/responses/responses'
import type { ConversationStore } from '../../src/server/conversation-store.ts'
import { openDatabase } from '../../src/server/database.ts'
import type { FileStore } from '../../src/server/file-store.ts'
import { ProjectIndex } from '../../src/server/project-index.ts'
import { ProjectStore } from '../../src/server/project-store.ts'
import { TOOL_STOPPED, ToolRegistry } from '../../src/server/tool-registry.ts'
import { SearchProjectFilesTool } from '../../src/server/tools/project-files.ts'
import {
  answerEvents,
  drain,
  memoryStore,
  testFiles,
  type FakeCall,
  testChat,
} from './fakes.ts'

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
      model: 'emb',
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

  it('is offered in project chats with files, with their names', async () => {
    const tool = new SearchProjectFilesTool(projects, index)
    const chat = store.createConversation({ projectId })
    expect(tool.offeredIn(chat)).toBe(false)
    await add('plan.md', 'Kyoto.')
    expect(tool.offeredIn(chat)).toBe(true)
    expect(tool.offeredIn(store.createConversation())).toBe(false)
    expect(tool.instructions(chat)).toContain('search_project_files: plan.md')

    const output = JSON.parse(
      await tool.run(
        { query: 'Kyoto' },
        { conversationId: chat.id, projectId },
      ),
    )
    expect(output.results).toEqual([
      { file: 'plan.md', file_id: expect.any(String), text: 'Kyoto.' },
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
      model: 'emb',
    })
    const registry = new ToolRegistry([
      new SearchProjectFilesTool(projects, slow),
    ])
    const stop = new AbortController()
    const call: ResponseFunctionToolCall = {
      type: 'function_call',
      call_id: 'call_1',
      name: 'search_project_files',
      arguments: '{"query":"kyoto"}',
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
      tools: new ToolRegistry([new SearchProjectFilesTool(projects, index)]),
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
    ])

    const loose = store.createConversation()
    await drain(chat.runTurn(loose.id, { text: 'Hi' }))
    expect(calls[1]!.params.instructions).not.toContain('Japan')
    expect(calls[1]!.params).not.toHaveProperty('tools')
  })
})
