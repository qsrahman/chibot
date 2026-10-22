import type { ConversationListItem } from '../shared/types.ts'

export interface ConversationGroup {
  label: string
  items: ConversationListItem[]
}

const DAY = 24 * 60 * 60 * 1000
const monthFormat = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
})

/**
 * Sidebar sections: Pinned, then Today / Yesterday / Previous 7 days /
 * Previous 30 days by last activity, then one per month. Expects the list in
 * the server's order (pinned first, newest first) and keeps it.
 */
export function groupConversations(
  list: ConversationListItem[],
  now = new Date(),
): ConversationGroup[] {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const groups: ConversationGroup[] = []
  for (const item of list) {
    const label = item.pinned
      ? 'Pinned'
      : labelFor(item.updatedAt, startOfToday)
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

function labelFor(time: number, startOfToday: number): string {
  if (time >= startOfToday) return 'Today'
  if (time >= startOfToday - DAY) return 'Yesterday'
  if (time >= startOfToday - 7 * DAY) return 'Previous 7 days'
  if (time >= startOfToday - 30 * DAY) return 'Previous 30 days'
  return monthFormat.format(time)
}
