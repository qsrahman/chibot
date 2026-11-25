import { CHAT_LIST_MAX, CHAT_PAGE } from '../../shared/list.ts'
import { Hono } from 'hono'
import { messageText } from '../../shared/messages.ts'
import {
  branchRequestSchema,
  conversationPatchSchema,
  createConversationSchema,
  switchVersionSchema,
} from '../../shared/requests.ts'
import type { ConversationWithItems } from '../../shared/types.ts'
import { branchChat } from './branch.ts'
import type { Attachments } from '../attachments.ts'
import type { ChatService } from './chat-service.ts'
import type { Compactor } from './compactor.ts'
import type {
  ConversationSearch,
  ConversationStore,
} from '../conversations/index.ts'
import type { FileStore } from '../file-store.ts'
import type { ProjectStore } from '../projects/index.ts'
import type { FollowUpWriter } from './follow-up-writer.ts'
import type { TitleWriter } from './title-writer.ts'
import { json, notFound } from '../routes/helpers.ts'

/** Listing, creating, changing, deleting and opening chats, and branching them. */
export function conversationCrudRoutes({
  store,
  search,
  chat,
  compactor,
  titles,
  followUps,
  files,
  projects,
  attachments,
}: {
  store: ConversationStore
  search: ConversationSearch
  chat: ChatService
  compactor: Compactor
  titles: TitleWriter
  followUps: FollowUpWriter
  files: FileStore
  projects: ProjectStore
  attachments: Attachments
}) {
  const app = new Hono()

  app.get('/api/conversations', (c) => {
    const q = c.req.query('q')?.trim()
    if (q) return c.json(search.conversations(q))
    // How many to list: more than a page when the sidebar asked for more.
    const asked = Number.parseInt(c.req.query('limit') ?? '', 10)
    const limit = Number.isFinite(asked)
      ? Math.min(Math.max(asked, 1), CHAT_LIST_MAX)
      : CHAT_PAGE
    return c.json(
      store.listConversations({
        archived: c.req.query('archived') === '1',
        limit,
      }),
    )
  })

  app.post(
    '/api/conversations',
    // The body is optional: `{ temporary: true }` starts a temporary chat.
    json(createConversationSchema),
    (c) => {
      const request = c.req.valid('json')
      if (request.projectId && !projects.get(request.projectId)) {
        return notFound(c, 'Project')
      }
      return c.json(store.createConversation(request), 201)
    },
  )

  app.patch('/api/conversations/:id', json(conversationPatchSchema), (c) => {
    const patch = c.req.valid('json')
    if (patch.projectId && !projects.get(patch.projectId)) {
      return notFound(c, 'Project')
    }
    const updated = store.updateConversation(c.req.param('id'), patch)
    if (!updated) return notFound(c)
    return c.json(updated)
  })

  app.post('/api/conversations/:id/title', async (c) => {
    const id = c.req.param('id')
    const conversation = store.getConversation(id)
    if (!conversation) return notFound(c)
    if (conversation.temporary) {
      return c.json({ error: 'Temporary chats have no title' }, 400)
    }
    if (!store.getPath(id).some((item) => messageText(item.data))) {
      return c.json({ error: 'There is nothing to title yet' }, 400)
    }
    const title = await titles.regenerate(id, c.req.raw.signal)
    if (!title) {
      return c.json({ error: 'The model gave no title; try again' }, 502)
    }
    return c.json({ title })
  })

  // Asked by the browser once an answer is saved, not sent with the turn's
  // events: the turn ends when the answer does, and a failure here is just no chips.
  app.post('/api/conversations/:id/suggestions', async (c) => {
    const id = c.req.param('id')
    if (!store.getConversation(id)) return notFound(c)
    return c.json({
      suggestions: await followUps.suggest(id, c.req.raw.signal),
    })
  })

  app.delete('/api/conversations/:id', (c) => {
    if (!store.deleteConversation(c.req.param('id'))) {
      return notFound(c)
    }
    attachments.deleteOrphans()
    return c.body(null, 204)
  })

  app.get('/api/conversations/:id', (c) => {
    const id = c.req.param('id')
    const conversation = store.getConversation(id)
    if (!conversation) return notFound(c)
    const items = store.getPath(id)
    return c.json({
      conversation,
      items,
      compactions: compactor.onPath(id, items),
      usage: store.getUsageTotals(id),
    } satisfies ConversationWithItems)
  })

  // A new chat with this one up to the end of a turn, to carry on from there.
  app.post('/api/conversations/:id/branch', json(branchRequestSchema), (c) => {
    const result = branchChat(
      { store, files, compactor, chat },
      c.req.param('id'),
      c.req.valid('json').itemId,
    )
    if ('error' in result) {
      return c.json({ error: result.error }, result.status)
    }
    return c.json(result.conversation, 201)
  })

  app.put('/api/conversations/:id/leaf', json(switchVersionSchema), (c) => {
    const id = c.req.param('id')
    if (!store.getConversation(id)) return notFound(c)
    if (!store.switchToVersion(id, c.req.valid('json').itemId)) {
      return notFound(c, 'Item')
    }
    return c.body(null, 204)
  })

  return app
}
