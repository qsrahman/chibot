import { describe, expect, it } from 'vitest'
import type {
  ConversationListItem,
  Project,
} from '../../../src/shared/types.ts'
import { recentChats, recentProjects } from '../../../src/web/chat/recents.ts'

const chat = (id: string, updatedAt: number, extra = {}) =>
  ({
    id,
    updatedAt,
    archived: false,
    temporary: false,
    currentLeafId: 1,
    ...extra,
  }) as ConversationListItem
const project = (id: string, updatedAt: number) =>
  ({ id, updatedAt }) as Project

describe('recentChats', () => {
  it('takes the three newest, skipping archived, temporary and empty chats', () => {
    const list = [
      chat('old', 1),
      chat('a', 5),
      chat('archived', 9, { archived: true }),
      chat('temp', 8, { temporary: true }),
      chat('blank', 7, { currentLeafId: null }),
      chat('b', 4),
      chat('c', 3),
    ]
    expect(recentChats(list).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('is empty without history', () => {
    expect(recentChats([])).toEqual([])
  })
})

describe('recentProjects', () => {
  it('takes the two touched last', () => {
    const list = [project('a', 1), project('b', 3), project('c', 2)]
    expect(recentProjects(list).map((p) => p.id)).toEqual(['b', 'c'])
  })
})
