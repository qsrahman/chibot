import { describe, expect, it } from 'vitest'
import type { ConversationListItem } from '../../src/shared/types.ts'
import { groupConversations } from '../../src/web/dates.ts'

const now = new Date(2026, 9, 22, 15, 0) // 22 Oct 2026, 15:00 local
const daysAgo = (n: number, hour = 12) =>
  new Date(2026, 9, 22 - n, hour).getTime()

const item = (id: string, updatedAt: number, pinned = false) =>
  ({ id, updatedAt, pinned }) as ConversationListItem

describe('groupConversations', () => {
  it('groups by pin and recency, keeping order', () => {
    const list = [
      item('pin', daysAgo(40), true),
      item('today', daysAgo(0, 1)),
      item('yesterday', daysAgo(1, 23)),
      item('week', daysAgo(6)),
      item('month', daysAgo(20)),
      item('older', daysAgo(60)),
    ]
    const groups = groupConversations(list, now)
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Pinned', ['pin']],
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['Previous 7 days', ['week']],
      ['Previous 30 days', ['month']],
      [
        new Intl.DateTimeFormat(undefined, {
          month: 'long',
          year: 'numeric',
        }).format(daysAgo(60)),
        ['older'],
      ],
    ])
  })

  it('returns no groups for an empty list', () => {
    expect(groupConversations([], now)).toEqual([])
  })
})
