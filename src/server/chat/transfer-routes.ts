import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { fileKind } from '../../shared/documents.ts'
import {
  conversationExportSchema,
  replaceFileIds,
  type ConversationExport,
} from '../../shared/export.ts'
import { toMarkdown } from '../conversations/index.ts'
import type { ConversationStore } from '../conversations/index.ts'
import type { FileStore } from '../file-store.ts'
import { disposition, json, notFound } from '../routes/helpers.ts'

// Exports embed their files (base64).
const IMPORT_LIMIT = 200 * 1024 * 1024

/** Exporting a chat (JSON with its files, or Markdown) and importing one. */
export function conversationTransferRoutes({
  store,
  files,
}: {
  store: ConversationStore
  files: FileStore
}) {
  const app = new Hono()

  app.get('/api/conversations/:id/export', (c) => {
    const id = c.req.param('id')
    const exported = store.exportConversation(id)
    if (!exported) return notFound(c)
    const markdown = c.req.query('format') === 'md'
    const name = `${exported.conversation.title ?? 'chat'}.${markdown ? 'md' : 'json'}`
    const chatFiles = files.ofConversation(id)
    const body = markdown
      ? toMarkdown(
          store.getConversation(id)!,
          store.getPath(id),
          new Map(chatFiles.map((file) => [file.id, file.name])),
        )
      : JSON.stringify(
          {
            ...exported,
            files: chatFiles.map(({ id, name }) => ({
              id,
              name,
              data: files.read(id).toString('base64'),
            })),
          } satisfies ConversationExport,
          null,
          2,
        )
    return c.body(body, 200, {
      'Content-Type': markdown
        ? 'text/markdown; charset=utf-8'
        : 'application/json; charset=utf-8',
      'Content-Disposition': disposition('attachment', name),
    })
  })

  app.post(
    '/api/conversations/import',
    bodyLimit({
      maxSize: IMPORT_LIMIT,
      onError: (c) => c.json({ error: 'The file is larger than 200 MB' }, 413),
    }),
    json(conversationExportSchema),
    (c) => {
      const { files: embedded, ...data } = c.req.valid('json')
      const savedIds = new Map<string, string>()
      const saved = embedded.map(({ id, name, data: base64 }) => {
        // The type follows the name, as for uploads: an export can't choose
        // how a file is served.
        const mime = fileKind(name)?.mime ?? 'application/octet-stream'
        const file = files.save(null, name, mime, Buffer.from(base64, 'base64'))
        savedIds.set(id, file.id)
        return file.id
      })
      const conversation = store.importConversation({
        ...data,
        items: replaceFileIds(data.items, savedIds),
      })
      files.link(saved, conversation.id)
      return c.json(conversation, 201)
    },
  )

  return app
}
