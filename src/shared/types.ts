// Types shared by the server and the web app. Item and event shapes come from
// the SDK; only chibot's own records are defined here.
import type {
  ResponseInputItem,
  ResponseUsage,
} from 'openai/resources/responses/responses'
import type { z } from 'zod'
import type { conversationPatchSchema, turnRequestSchema } from './requests.ts'

export interface Conversation {
  id: string
  title: string | null
  currentLeafId: number | null
  pinned: boolean
  archived: boolean
  /** Hidden from lists and search, and deleted when the user leaves it. */
  temporary: boolean
  createdAt: number
  updatedAt: number
}

/** A row in the sidebar or in search results. */
export interface ConversationListItem extends Conversation {
  /** Search only: matching message text around the hit. */
  snippet?: string
}

/** Fields `PATCH /api/conversations/:id` accepts. */
export type ConversationPatch = z.output<typeof conversationPatchSchema>

/** One node of a conversation's history tree. */
export interface StoredItem {
  id: number
  parentId: number | null
  data: ResponseInputItem
  /** Set on the last item of each model response. */
  usage: ResponseUsage | null
  /** The model that wrote the response; set like `usage`. */
  model: string | null
  /**
   * This item and its alternative versions (same parent: edits of a message,
   * or regenerated answers), oldest first. Just `[id]` when there are none.
   */
  siblingIds: number[]
  createdAt: number
}

export interface ConversationWithItems {
  conversation: Conversation
  /** Path from the root to the current leaf. */
  items: StoredItem[]
  /** Tokens used by every response in the conversation, all versions included. */
  usage: ResponseUsage
}

/** Body of `POST /api/conversations/:id/turns` (see `turnRequestSchema`). */
export type TurnRequest = z.output<typeof turnRequestSchema>

/** SSE event chibot sends when a turn fails, alongside the SDK's own events. */
export interface TurnErrorEvent {
  type: 'chibot.error'
  message: string
  status?: number
  requestId?: string
}

/** SSE event sent after `response.completed` once a new title is generated. */
export interface TurnTitleEvent {
  type: 'chibot.title'
  title: string
}

/** `GET /api/models`: the chat endpoint's models, or `null` if it can't list them. */
export interface ModelsResponse {
  models: string[] | null
}
