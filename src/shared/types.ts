// Types shared by the server and the web app. Item and event shapes come from
// the SDK; only chibot's own records are defined here.
import type {
  ResponseInputItem,
  ResponseUsage,
} from 'openai/resources/responses/responses'

export interface Conversation {
  id: string
  title: string | null
  currentLeafId: number | null
  createdAt: number
  updatedAt: number
}

/** One node of a conversation's history tree. */
export interface StoredItem {
  id: number
  parentId: number | null
  data: ResponseInputItem
  /** Set on the last item of each model response. */
  usage: ResponseUsage | null
  createdAt: number
}

export interface ConversationWithItems {
  conversation: Conversation
  /** Path from the root to the current leaf. */
  items: StoredItem[]
}

/** SSE event chibot sends when a turn fails, alongside the SDK's own events. */
export interface TurnErrorEvent {
  type: 'chibot.error'
  message: string
  status?: number
  requestId?: string
}
