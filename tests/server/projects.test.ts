import { beforeEach, describe, expect, it } from 'vitest'
import type { ConversationStore } from '../../src/server/conversation-store.ts'
import { openDatabase } from '../../src/server/database.ts'
import type { FileStore } from '../../src/server/file-store.ts'
import { ProjectStore } from '../../src/server/project-store.ts'
import type {
  Conversation,
  ConversationListItem,
  Project,
  ProjectWithContents,
} from '../../src/shared/types.ts'
import { memoryStore, testApp, testFiles } from './fakes.ts'

describe('projects', () => {
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

  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return {
      status: res.status,
      body: (await res.json().catch(() => null)) as T,
    }
  }

  it('creates, renames and lists projects with their instructions', async () => {
    const { status, body: project } = await call<Project>(
      'POST',
      '/api/projects',
      { name: ' Trip ' },
    )
    expect(status).toBe(201)
    expect(project).toMatchObject({ name: 'Trip', instructions: '' })

    const { body: updated } = await call<Project>(
      'PATCH',
      `/api/projects/${project.id}`,
      { name: 'Japan trip', instructions: 'Prices in yen.' },
    )
    expect(updated).toMatchObject({
      name: 'Japan trip',
      instructions: 'Prices in yen.',
    })
    expect((await call<Project[]>('GET', '/api/projects')).body).toEqual([
      updated,
    ])
    expect((await call('POST', '/api/projects', { name: ' ' })).status).toBe(
      400,
    )
    expect((await call('GET', '/api/projects/nope')).status).toBe(404)
  })

  it('keeps project chats out of the main list, and moves chats', async () => {
    const project = projects.create('Trip')
    const { body: inProject } = await call<Conversation>(
      'POST',
      '/api/conversations',
      { projectId: project.id },
    )
    expect(inProject.projectId).toBe(project.id)
    store.appendItems(inProject.id, null, [{ role: 'user', content: 'hi' }])
    const loose = store.createConversation()
    store.appendItems(loose.id, null, [{ role: 'user', content: 'hey' }])

    const main = await call<ConversationListItem[]>('GET', '/api/conversations')
    expect(main.body.map((c) => c.id)).toEqual([loose.id])
    const contents = await call<ProjectWithContents>(
      'GET',
      `/api/projects/${project.id}`,
    )
    expect(contents.body.conversations.map((c) => c.id)).toEqual([inProject.id])

    await call('PATCH', `/api/conversations/${loose.id}`, {
      projectId: project.id,
    })
    expect(store.listConversations({ projectId: project.id })).toHaveLength(2)
    await call('PATCH', `/api/conversations/${loose.id}`, { projectId: null })
    expect(store.listConversations().map((c) => c.id)).toEqual([loose.id])

    expect(
      (await call('POST', '/api/conversations', { projectId: 'nope' })).status,
    ).toBe(404)
    expect(
      (
        await call('PATCH', `/api/conversations/${loose.id}`, {
          projectId: 'nope',
        })
      ).status,
    ).toBe(404)
  })

  it('deletes a project with its chats and files', async () => {
    const project = projects.create('Trip')
    const chat = store.createConversation({ projectId: project.id })
    store.updateConversation(chat.id, { archived: true })
    const file = files.save(null, 'notes.md', 'text/markdown', Buffer.from('#'))
    projects.addFile(project.id, file.id)
    const other = store.createConversation()

    expect((await call('DELETE', `/api/projects/${project.id}`)).status).toBe(
      204,
    )
    expect(projects.get(project.id)).toBeNull()
    expect(store.getConversation(chat.id)).toBeUndefined()
    expect(store.getConversation(other.id)).toBeDefined()
    expect(files.get(file.id)).toBeNull()
    expect((await call('DELETE', `/api/projects/${project.id}`)).status).toBe(
      404,
    )
  })
})
