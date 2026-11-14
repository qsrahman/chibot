import { Hono } from 'hono'
import type { Attachments } from '../attachments.ts'
import type { ChatService } from './chat-service.ts'
import type { Compactor } from './compactor.ts'
import type {
  ConversationSearch,
  ConversationStore,
} from '../conversations/index.ts'
import type { FileStore } from '../file-store.ts'
import type { ProjectStore } from '../projects/index.ts'
import type { TitleWriter } from './title-writer.ts'
import { conversationCrudRoutes } from './conversation-routes.ts'
import { conversationTransferRoutes } from './transfer-routes.ts'
import { conversationTurnRoutes } from './turn-routes.ts'

/** Everything under `/api/conversations`, in three parts. */
export function conversationRoutes(deps: {
  store: ConversationStore
  search: ConversationSearch
  chat: ChatService
  compactor: Compactor
  titles: TitleWriter
  files: FileStore
  projects: ProjectStore
  attachments: Attachments
}) {
  return new Hono()
    .route('/', conversationCrudRoutes(deps))
    .route('/', conversationTransferRoutes(deps))
    .route('/', conversationTurnRoutes(deps))
}
