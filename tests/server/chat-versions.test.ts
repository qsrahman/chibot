import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app.ts'
import { ChatService } from '../../src/server/chat-service.ts'
import { Config } from '../../src/server/config.ts'
import { ConversationStore } from '../../src/server/conversation-store.ts'
import { messageText } from '../../src/shared/messages.ts'
import { answerEvents, drain, fakeClient, type FakeCall } from './fakes.ts'

describe('edit, regenerate and switch versions', () => {
  let store: ConversationStore
  let calls: FakeCall[]
  let chat: ChatService
  let id: string
  beforeEach(() => {
    store = new ConversationStore(':memory:')
    calls = []
    chat = new ChatService(fakeClient(answerEvents('ans'), calls), store, 'm')
    id = store.createConversation().id
  })
  afterEach(() => store.close())

  const texts = () =>
    store.getPath(id).map((i) => messageText(i.data)?.text ?? i.data.type)
  const lastInput = () =>
    (calls.at(-1)!.params.input as { content: unknown }[]).map((i) =>
      typeof i.content === 'string' ? i.content : 'ans',
    )

  it('regenerates an answer as a sibling, sending history up to the question', async () => {
    await drain(chat.runTurn(id, { text: 'q1' }))
    const [q1, a1] = store.getPath(id)
    await drain(chat.runTurn(id, { parentId: q1!.id }))

    expect(lastInput()).toEqual(['q1'])
    const [, a2] = store.getPath(id)
    expect(a2!.siblingIds).toEqual([a1!.id, a2!.id])
    expect(texts()).toEqual(['q1', 'ans'])
  })

  it('edits a message as a sibling and answers it', async () => {
    await drain(chat.runTurn(id, { text: 'q1' }))
    const [, a1] = store.getPath(id)
    await drain(chat.runTurn(id, { text: 'q2' }))
    const q2 = store.getPath(id)[2]!

    await drain(chat.runTurn(id, { text: 'q2 edited', parentId: a1!.id }))
    expect(lastInput()).toEqual(['q1', 'ans', 'q2 edited'])
    const path = store.getPath(id)
    expect(texts()).toEqual(['q1', 'ans', 'q2 edited', 'ans'])
    expect(path[2]!.siblingIds).toEqual([q2.id, path[2]!.id])
  })

  it('edits the first message under the root', async () => {
    await drain(chat.runTurn(id, { text: 'q1' }))
    await drain(chat.runTurn(id, { text: 'q1 edited', parentId: null }))
    expect(lastInput()).toEqual(['q1 edited'])
    expect(store.getPath(id)[0]!.siblingIds).toHaveLength(2)
  })

  describe('routes', () => {
    const config = new Config({ OPENAI_API_KEY: 'k' })
    const app = () => createApp({ config, store, chat })
    const send = (body: unknown) =>
      app().request(`/api/conversations/${id}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const switchTo = (body: unknown, conversation = id) =>
      app().request(`/api/conversations/${conversation}/leaf`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    it('validates turn requests', async () => {
      await drain(chat.runTurn(id, { text: 'q1' }))
      const [q1, a1] = store.getPath(id)
      expect((await send({})).status).toBe(400)
      expect((await send({ parentId: 'x' })).status).toBe(400)
      expect((await send({ text: 'hi', parentId: 9999 })).status).toBe(404)
      // Only a user message can be regenerated.
      expect((await send({ parentId: a1!.id })).status).toBe(400)
      const ok = await send({ parentId: q1!.id })
      expect(ok.status).toBe(200)
      await ok.text()
    })

    it('switches versions', async () => {
      await drain(chat.runTurn(id, { text: 'q1' }))
      const [q1] = store.getPath(id)
      await drain(chat.runTurn(id, { text: 'other', parentId: null }))
      expect(texts()[0]).toBe('other')

      expect((await switchTo({ itemId: q1!.id })).status).toBe(204)
      expect(texts()[0]).toBe('q1')
      expect((await switchTo({ itemId: 9999 })).status).toBe(404)
      expect((await switchTo({ itemId: 'x' })).status).toBe(400)
      expect((await switchTo({ itemId: q1!.id }, 'nope')).status).toBe(404)
    })
  })
})
