// Types shared by the server and the web app. Item and event shapes come from
// the SDK; only chibot's own records are defined here.
import type {
  ResponseFunctionToolCall,
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
  /** The project it's in, if any. */
  projectId: string | null
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

/** A past chat's best matches for `search_chats`, in chat order. */
export interface ChatMatch {
  conversationId: string
  title: string | null
  messages: {
    role: 'user' | 'assistant'
    /** When it was written (ms). */
    writtenAt: number
    excerpt: string
  }[]
}

/** A project: chats and files that share instructions. */
export interface Project {
  id: string
  name: string
  /** Added to the instructions of the project's chats. */
  instructions: string
  createdAt: number
  updatedAt: number
}

/** A file in a project, with how far its indexing got. */
export interface ProjectFile {
  fileId: string
  name: string
  mime: string
  size: number
  status: 'indexing' | 'ready' | 'failed'
  /** Why indexing failed. */
  error: string | null
}

/** `GET /api/projects/:id`. */
export interface ProjectWithContents {
  project: Project
  files: ProjectFile[]
  conversations: ConversationListItem[]
}

/** A file chibot keeps (a generated image), served by `GET /api/files/:id`. */
export interface StoredFile {
  id: string
  /** The chat it belongs to; it's deleted with it. */
  conversationId: string | null
  name: string
  mime: string
  size: number
  createdAt: number
}

/** Something chibot remembers about the user (`GET /api/memories`). */
export interface Memory {
  id: number
  text: string
  createdAt: number
  updatedAt: number
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

/** SSE event sent after chibot ran a tool the model called. */
export interface TurnToolOutputEvent {
  type: 'chibot.tool_output'
  call_id: string
  output: string
}

/**
 * SSE event that ends a turn whose tool calls wait for the user's approval
 * (answered with `TurnRequest.approvals`).
 */
export interface TurnApprovalEvent {
  type: 'chibot.approval'
  calls: ResponseFunctionToolCall[]
}

/** A tool in `GET /api/tools` (`{ tools: ToolInfo[] }`). */
export interface ToolInfo {
  name: string
  /** What the user sees, e.g. "Web search". */
  label: string
}

/** `GET /api/health`. */
export interface Health {
  status: 'ok'
  /** The chat model from the environment. */
  model: string
  /** The chat endpoint; `null` is OpenAI. */
  baseURL: string | null
}

/** `GET /api/models`: the chat endpoint's models, or `null` if it can't list them. */
export interface ModelsResponse {
  models: string[] | null
}
