import { z } from 'zod'
import type { ConversationStore } from '../conversation-store.ts'
import type { Conversation } from '../../shared/types.ts'
import { Tool, type ToolContext } from '../tool.ts'

const date = z.string().nullable()

/** Searches the user's other chats (the full-text index, all local). */
export class SearchChatsTool extends Tool {
  readonly name = 'search_chats'
  readonly label = 'Search past chats'
  readonly description =
    "Searches the user's earlier chats with you (their messages and your " +
    'answers) and returns each matching chat’s title with its best-matching ' +
    'messages (excerpts, in order, with role and date). Use it when the ' +
    'user refers to something discussed before. ' +
    'Put dates in after/before rather than in the query.'
  readonly parameters = z.object({
    query: z.string().describe('Words the messages may contain'),
    after: date.describe(
      'Only messages on or after this date (YYYY-MM-DD), or null',
    ),
    before: date.describe(
      'Only messages before this date (YYYY-MM-DD), or null',
    ),
  })
  readonly #store: ConversationStore

  constructor(store: ConversationStore) {
    super()
    this.#store = store
  }

  override offeredIn({ temporary }: Conversation) {
    return !temporary
  }

  async run(
    { query, after, before }: z.output<typeof this.parameters>,
    { conversationId }: ToolContext,
  ) {
    const results = this.#store
      .searchMessages(query, {
        excludeId: conversationId,
        after: startOf(after),
        before: startOf(before),
      })
      .map(({ conversationId, title, messages }) => ({
        chat_id: conversationId,
        title: title ?? 'Untitled',
        messages: messages.map(({ role, writtenAt, excerpt }) => ({
          role,
          // Local, like the after/before filter ('sv' formats as YYYY-MM-DD).
          date: new Date(writtenAt).toLocaleDateString('sv'),
          excerpt,
        })),
      }))
    return JSON.stringify({ query, results })
  }
}

/** Local midnight of a YYYY-MM-DD date (chibot runs where the user is). */
function startOf(day: string | null): number | null {
  if (day === null) return null
  const time = new Date(`${day}T00:00`).getTime()
  if (Number.isNaN(time)) throw new Error(`"${day}" is not a YYYY-MM-DD date`)
  return time
}
