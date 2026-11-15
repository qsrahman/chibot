import type { TurnErrorEvent } from '../../shared/types.ts'
import type { ConversationListItem, Project } from '../../shared/types.ts'

/** Chats and projects the new-chat page offers to go back to. */
export const RECENT_CHATS = 3
export const RECENT_PROJECTS = 2

/**
 * The newest chats, from the sidebar's list (which has no archived ones):
 * not temporary ones, and not chats that never got a message.
 */
export function recentChats(
  list: ConversationListItem[],
  count = RECENT_CHATS,
): ConversationListItem[] {
  return list
    .filter((c) => !c.archived && !c.temporary && c.currentLeafId !== null)
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, count)
}

/** The projects touched last. */
export function recentProjects(
  list: Project[],
  count = RECENT_PROJECTS,
): Project[] {
  return list.toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, count)
}

/** What a new chat shows under the greeting. */
export type EmptyState = 'setup' | 'recents' | 'starters'

/**
 * Setup comes first (nothing can be answered); then somewhere to carry on;
 * the starters are for a first visit, and wait until the lists have loaded so
 * they don't flash up before the recents replace them.
 */
export function emptyState({
  configured,
  hasRecents,
  loaded,
}: {
  configured: boolean
  hasRecents: boolean
  loaded: boolean
}): EmptyState | null {
  if (!configured) return 'setup'
  if (hasRecents) return 'recents'
  return loaded ? 'starters' : null
}

/** Why chibot can't answer, when the setup is to blame. */
export type SetupProblem = 'missing' | 'rejected' | 'unreachable'

/**
 * Only what the failed request says outright: the server's status 401 or 403
 * (the key is refused), or no connection at all. Provider messages are not read.
 */
export function setupProblem(
  failure: Pick<TurnErrorEvent, 'status' | 'unreachable'>,
): SetupProblem | null {
  if (failure.status === 401 || failure.status === 403) return 'rejected'
  return failure.unreachable ? 'unreachable' : null
}
