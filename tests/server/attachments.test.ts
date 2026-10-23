import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import { Attachments } from '../../src/server/attachments.ts'
import { ChatService } from '../../src/server/chat-service.ts'
import type { ConversationStore } from '../../src/server/conversation-store.ts'
import { openDatabase } from '../../src/server/database.ts'
import type { FileStore } from '../../src/server/file-store.ts'
import {
  answerEvents,
  drain,
  fakeClient,
  memoryStore,
  testApp,
  testFiles,
  testSettings,
  type FakeCall,
} from './fakes.ts'

const PDF = readFileSync(join(import.meta.dirname, '../fixtures/secret.pdf'))
const PNG = Buffer.from([137, 80, 78, 71])

const badRequest = (message: string) =>
  new OpenAI.BadRequestError(400, { message }, message, new Headers())

/** The parts of the user message sent last. */
const sentParts = (call: FakeCall) =>
  (call.params.input as { role?: string; content: unknown }[]).findLast(
    (item) => item.role === 'user',
  )!.content

describe('attachments', () => {
  let store: ConversationStore
  let files: FileStore
  let conversationId: string
  let ids: { image: string; pdf: string }
  beforeEach(() => {
    const db = openDatabase(':memory:')
    store = memoryStore(db)
    files = testFiles(db)
    conversationId = store.createConversation().id
    ids = {
      image: files.save(null, 'red.png', 'image/png', PNG).id,
      pdf: files.save(null, 'secret.pdf', 'application/pdf', PDF).id,
    }
  })

  function chatWith(
    options: Parameters<typeof fakeClient>[2],
    calls: FakeCall[],
  ) {
    const client = fakeClient(answerEvents('ok'), calls, options)
    return new ChatService(client, store, testSettings('m'), {
      attachments: new Attachments(client, files),
    })
  }
  const send = (chat: ChatService, text = 'What is this?') =>
    drain(
      chat.runTurn(conversationId, {
        text,
        fileIds: [ids.image, ids.pdf],
      }),
    )

  it('stores parts that point at chibot’s files', async () => {
    await send(chatWith({}, []))
    expect(store.getPath(conversationId)[0]!.data).toEqual({
      role: 'user',
      content: [
        { type: 'input_image', file_id: ids.image, detail: 'auto' },
        { type: 'input_file', file_id: ids.pdf, filename: 'secret.pdf' },
        { type: 'input_text', text: 'What is this?' },
      ],
    })
  })

  it('uploads each file once and sends its Files API id', async () => {
    const calls: FakeCall[] = []
    const uploads: string[] = []
    const chat = chatWith({ uploads }, calls)
    await send(chat)
    await drain(chat.runTurn(conversationId, { text: 'And now?' }))

    expect(uploads).toEqual(['red.png', 'secret.pdf'])
    expect(sentParts(calls[0]!)).toEqual([
      { type: 'input_image', file_id: 'file-1', detail: 'auto' },
      // No filename: OpenAI refuses it beside file_id.
      { type: 'input_file', file_id: 'file-2' },
      { type: 'input_text', text: 'What is this?' },
    ])
    // The history's files go by the same ids on later turns.
    expect(JSON.stringify(calls[1]!.params.input)).toContain('"file-2"')
    expect(files.get(ids.pdf)!.providerFileId).toBe('file-2')
  })

  it('sends files inline when the server has no Files API', async () => {
    const calls: FakeCall[] = []
    const noFilesApi = new OpenAI.NotFoundError(404, {}, 'nope', new Headers())
    await send(chatWith({ uploads: noFilesApi }, calls))
    expect(sentParts(calls[0]!)).toEqual([
      {
        type: 'input_image',
        image_url: `data:image/png;base64,${PNG.toString('base64')}`,
        detail: 'auto',
      },
      {
        type: 'input_file',
        filename: 'secret.pdf',
        file_data: `data:application/pdf;base64,${PDF.toString('base64')}`,
      },
      { type: 'input_text', text: 'What is this?' },
    ])
  })

  it('sends documents as text to a model that rejects files', async () => {
    const calls: FakeCall[] = []
    const reject = ({ input }: { input?: unknown }) =>
      JSON.stringify(input).includes('"input_file"')
        ? badRequest('file inputs are not currently supported')
        : undefined
    const chat = chatWith({ reject }, calls)
    await send(chat)
    await drain(chat.runTurn(conversationId, { text: 'More?' }))

    // Sent with files, again without reasoning/compaction (the 400 could be
    // those), then with documents as text.
    expect(sentParts(calls[2]!)).toEqual([
      { type: 'input_image', file_id: 'file-1', detail: 'auto' },
      {
        type: 'input_text',
        text: 'Attached file secret.pdf:\n\nThe secret code is KESTREL.',
      },
      { type: 'input_text', text: 'What is this?' },
    ])
    // Remembered: the next turn goes as text straight away.
    expect(calls).toHaveLength(4)
  })

  it('says so when a model refuses the images', async () => {
    const reject = () => badRequest('this model does not support image input')
    const events = await drain(
      chatWith({ reject }, []).runTurn(conversationId, {
        text: 'What colour?',
        fileIds: [ids.image],
      }),
    ).catch((err: Error) => err)
    expect(events).toBeInstanceOf(Error)
    expect((events as Error).message).toMatch(
      /^m refused this chat's images \(400 this model does not support image input\)\. If it can’t see images, pick a model that can/,
    )
  })

  it('uploads again when the provider lost a file', async () => {
    const calls: FakeCall[] = []
    const uploads: string[] = []
    files.setProviderId(ids.pdf, 'file-gone')
    const reject = ({ input }: { input?: unknown }) =>
      JSON.stringify(input).includes('file-gone')
        ? new OpenAI.NotFoundError(
            404,
            {},
            'Files [file-gone] were not found',
            new Headers(),
          )
        : undefined
    await send(chatWith({ reject, uploads }, calls))

    expect(calls).toHaveLength(2)
    expect(uploads).toEqual(['red.png', 'red.png', 'secret.pdf'])
    expect(files.get(ids.pdf)!.providerFileId).toBe('file-3')
  })

  it('only attaches uploads, or this chat’s own files', async () => {
    const other = store.createConversation().id
    const elsewhere = files.save(other, 'b.png', 'image/png', PNG).id
    const app = testApp({ store, files })
    const turn = (fileIds: string[]) =>
      app.request(`/api/conversations/${conversationId}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hi', fileIds }),
      })
    expect((await turn([elsewhere])).status).toBe(400)
    expect((await turn(['nope'])).status).toBe(400)
    expect(files.get(ids.image)!.conversationId).toBeNull()
  })

  it('deletes the provider’s copies with the chat', async () => {
    const deletedUploads: string[] = []
    const client = fakeClient(answerEvents('ok'), [], { deletedUploads })
    const attachments = new Attachments(client, files)
    const chat = new ChatService(client, store, testSettings('m'), {
      attachments,
    })
    const app = testApp({ store, files, chat, attachments })
    // The route links the files to the chat, then the turn uploads them.
    await (
      await app.request(`/api/conversations/${conversationId}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hi', fileIds: [ids.image, ids.pdf] }),
      })
    ).text()
    expect(files.get(ids.pdf)!.conversationId).toBe(conversationId)

    await app.request(`/api/conversations/${conversationId}`, {
      method: 'DELETE',
    })
    expect(files.get(ids.pdf)).toBeNull()
    expect(deletedUploads.sort()).toEqual(['file-1', 'file-2'])
  })
})
