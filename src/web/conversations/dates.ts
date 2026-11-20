import type { ConversationListItem } from '../../shared/types.ts'

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

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const dayFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
})

/** "just now", "5 minutes ago", "yesterday", then a date after a week. */
export function relativeTime(time: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600)
    return relative.format(-Math.floor(seconds / 60), 'minute')
  if (seconds < DAY / 1000) {
    return relative.format(-Math.floor(seconds / 3600), 'hour')
  }
  const days = Math.round(
    (new Date(now).setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) /
      DAY,
  )
  if (days < 7) return relative.format(-Math.max(days, 1), 'day')
  return dayFormat.format(time)
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** When a message was written: the time today, "Yesterday, 9:07 PM", else the date and time. */
export function messageTime(time: number, now = new Date()): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (time >= startOfToday) return `Today, ${timeFormat.format(time)}`
  if (time >= startOfToday - DAY) return `Yesterday, ${timeFormat.format(time)}`
  return dateTimeFormat.format(time)
}
