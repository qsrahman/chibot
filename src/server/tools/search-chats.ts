import { z } from 'zod'
import type { ConversationSearch } from '../conversation-search.ts'
import type { Conversation } from '../../shared/types.ts'
import { Tool, type ToolContext } from '../tool.ts'

const date = z.string().nullable()

/** Searches the user's other chats (the full-text index, all local). */
export class SearchChatsTool extends Tool {
  readonly name = 'search_chats'
  readonly label = 'Search past chats'
  override readonly group = 'Your chats and files'
  override readonly summary =
    'Finds your earlier chats on this machine when you refer to them.'
  override readonly running = 'Searching your chats…'
  override readonly done = 'Searched your chats'
  // Old chats hold whatever was pasted or fetched in them.
  override readonly untrustedOutput = true
  readonly description =
    "Searches the user's earlier chats with you (their messages and your " +
    'answers) and returns each matching chat’s title with its best-matching ' +
    'messages (excerpts, in order, with role and date). Use it when the ' +
    'user refers to something discussed before. ' +
    'Put dates in after/before rather than in the query. In a project chat ' +
    "it searches that project's chats only."
  readonly parameters = z.object({
    query: z.string().describe('Words the messages may contain'),
    after: date.describe(
      'Only messages on or after this date (YYYY-MM-DD), or null',
    ),
    before: date.describe(
      'Only messages before this date (YYYY-MM-DD), or null',
    ),
  })
  readonly #search: ConversationSearch

  constructor(search: ConversationSearch) {
    super()
    this.#search = search
  }

  override offeredIn({ temporary }: Conversation) {
    return !temporary
  }

  async run(
    { query, after, before }: z.output<typeof this.parameters>,
    { conversationId, projectId }: ToolContext,
  ) {
    const results = this.#search
      .messages(query, {
        excludeId: conversationId,
        projectId,
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

/**
 * Local midnight of a YYYY-MM-DD date (chibot runs where the user is). A
 * blank one means none (models often send "" for null), and a day the month
 * doesn't have (2026-02-31) is refused rather than rolled into March.
 */
function startOf(day: string | null): number | null {
  if (day === null || day.trim() === '') return null
  const date = new Date(`${day}T00:00`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    date.toLocaleDateString('sv') !== day
  ) {
    throw new Error(`"${day}" is not a YYYY-MM-DD date`)
  }
  return date.getTime()
}
