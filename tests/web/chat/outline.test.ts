import { describe, expect, it } from 'vitest'
import {
  currentOutlineIndex,
  outlineOf,
} from '../../../src/web/chat/outline.ts'
import type { Turn } from '../../../src/web/chat/turns.ts'

const turn = (text: string, attachments = 0) =>
  ({
    question: {
      text,
      attachments: Array.from({ length: attachments }, () => ({})),
    },
  }) as unknown as Turn

describe('outlineOf', () => {
  it('labels each message by its first non-empty line, in order', () => {
    expect(outlineOf([turn('\n  First line  \nsecond'), turn('Two')])).toEqual([
      { index: 0, label: 'First line' },
      { index: 1, label: 'Two' },
    ])
  })

  it('names a message with no text by what it carries', () => {
    expect(outlineOf([turn('', 1), turn('  ')])).toEqual([
      { index: 0, label: 'Attachment' },
      { index: 1, label: 'Message' },
    ])
  })
})

describe('currentOutlineIndex', () => {
  it('is the last message that has reached the top', () => {
    expect(currentOutlineIndex([-900, -300, 20, 500], 40)).toBe(2)
  })

  it('is the first when none has', () => {
    expect(currentOutlineIndex([100, 600], 40)).toBe(0)
  })
})
