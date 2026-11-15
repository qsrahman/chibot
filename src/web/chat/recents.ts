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
