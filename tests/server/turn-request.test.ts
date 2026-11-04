import { beforeEach, describe, expect, it } from 'vitest'
import type { ResponseInputItem } from 'openai/resources/responses/responses'
import { openDatabase } from '../../src/server/database.ts'
import { ProjectStore } from '../../src/server/projects/index.ts'
import { refuseTurn } from '../../src/server/turn-request.ts'
import { memoryStore, testChat, testFiles } from './fakes.ts'

describe('refuseTurn', () => {
  const db = () => openDatabase(':memory:')
  let deps: Parameters<typeof refuseTurn>[0]
  let id: string
  beforeEach(() => {
    const database = db()
    const store = memoryStore(database)
    const files = testFiles(database)
    deps = {
      store,
      chat: testChat([], { store }),
      files,
      projects: new ProjectStore(database, files),
    }
    id = store.createConversation().id
  })
  const bytes = new Uint8Array([1])
  const items = (...data: ResponseInputItem[]) =>
    deps.store.appendItems(id, null, data)

  it('lets an ordinary message through', () => {
    expect(refuseTurn(deps, id, { text: 'Hi' })).toBeNull()
  })

  describe('files', () => {
    it('takes uploads and this chat’s own files', () => {
      const upload = deps.files.save(null, 'a.png', 'image/png', bytes)
      const own = deps.files.save(id, 'b.png', 'image/png', bytes)
      expect(
        refuseTurn(deps, id, { text: 'Hi', fileIds: [upload.id, own.id] }),
      ).toBeNull()
    })

    it('refuses unknown files, other chats’ files, other types and project files', () => {
      const other = deps.store.createConversation().id
      const refused = (fileId: string) =>
        refuseTurn(deps, id, { text: 'Hi', fileIds: [fileId] })
      const project = deps.projects.create('P')
      const inProject = deps.files.save(
        null,
        'notes.md',
        'text/markdown',
        bytes,
      )
      deps.projects.addFile(project.id, inProject.id)

      for (const fileId of [
        'nope',
        deps.files.save(other, 'c.png', 'image/png', bytes).id,
        deps.files.save(null, 'tool.exe', 'application/octet-stream', bytes).id,
        inProject.id,
      ]) {
        expect(refused(fileId)).toEqual({
          status: 400,
          error: `File ${fileId} can't be attached here`,
        })
      }
    })
  })

  describe('approvals', () => {
    it('need calls waiting for them', () => {
      expect(refuseTurn(deps, id, { approvals: { c1: true } })).toEqual({
        status: 409,
        error: 'No tool calls are waiting for approval',
      })
      items(
        { role: 'user', content: 'Hi' },
        { type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{}' },
      )
      expect(refuseTurn(deps, id, { approvals: { c1: true } })).toBeNull()
    })
  })

  describe('parentId', () => {
    const [user, assistant, reasoning, output] = [0, 1, 2, 3]
    let ids: number[]
    beforeEach(() => {
      ids = items(
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { type: 'reasoning', id: 'r1', summary: [] },
        { type: 'function_call_output', call_id: 'c1', output: 'x' },
      ).map((item) => item.id)
    })
    const at = (index: number, text?: string) =>
      refuseTurn(deps, id, { parentId: ids[index], text })

    it('must be an item of the chat', () => {
      expect(refuseTurn(deps, id, { parentId: 999_999, text: 'Hi' })).toEqual({
        status: 404,
        error: 'Item not found',
      })
    })

    it('answers only a user message when regenerating', () => {
      expect(at(user)).toBeNull()
      expect(at(assistant)).toEqual({
        status: 400,
        error: 'Only a user message can be answered',
      })
    })

    it('lets a message follow a message or a tool output, not a reasoning item', () => {
      expect(at(user, 'More')).toBeNull()
      expect(at(assistant, 'More')).toBeNull()
      expect(at(output, 'More')).toBeNull()
      expect(at(reasoning, 'More')).toEqual({
        status: 400,
        error: 'A message can only follow a message or a tool output',
      })
    })
  })
})
