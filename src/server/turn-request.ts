import { fileKind } from '../shared/documents.ts'
import { messageText } from '../shared/messages.ts'
import type { TurnRequest } from '../shared/types.ts'
import type { ChatService } from './chat-service.ts'
import type { ConversationStore } from './conversation-store.ts'
import type { FileStore } from './file-store.ts'
import type { ProjectStore } from './project-store.ts'

/** Why a turn is refused: the HTTP status and the message the user sees. */
export interface Refusal {
  status: 400 | 404 | 409
  error: string
}

/**
 * Whether `request` may start a turn in the chat: its files can be attached
 * here, an approval has calls waiting, and its `parentId` is a place a message
 * (or an answer) can follow. `null` if it may.
 */
export function refuseTurn(
  {
    store,
    chat,
    files,
    projects,
  }: {
    store: ConversationStore
    chat: ChatService
    files: FileStore
    projects: ProjectStore
  },
  conversationId: string,
  request: TurnRequest,
): Refusal | null {
  // Attachments: our uploads (or this chat's own files), not a project's.
  for (const fileId of request.fileIds ?? []) {
    const file = files.get(fileId)
    if (
      !file ||
      !fileKind(file.name) ||
      projects.hasFile(fileId) ||
      (file.conversationId !== null && file.conversationId !== conversationId)
    ) {
      return { status: 400, error: `File ${fileId} can't be attached here` }
    }
  }
  if (request.approvals && chat.waitingCalls(conversationId).length === 0) {
    return { status: 409, error: 'No tool calls are waiting for approval' }
  }
  if (typeof request.parentId === 'number') {
    const parent = store.getItem(conversationId, request.parentId)
    if (!parent) return { status: 404, error: 'Item not found' }
    const role = messageText(parent.data)?.role
    // A regenerate answers a user message. A new or edited message follows a
    // message (another user message, after a turn that failed or was stopped
    // early) or a tool output (a stopped or denied call), but not an item in
    // the middle of an answer, such as reasoning.
    if (request.text === undefined) {
      if (role !== 'user') {
        return { status: 400, error: 'Only a user message can be answered' }
      }
    } else if (
      !role &&
      !('type' in parent.data && parent.data.type === 'function_call_output')
    ) {
      return {
        status: 400,
        error: 'A message can only follow a message or a tool output',
      }
    }
  }
  return null
}
