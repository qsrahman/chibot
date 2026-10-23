import { describe, expect, it } from 'vitest'
import { ChatService, chatInstructions } from '../../src/server/chat-service.ts'
import {
  answerEvents,
  drain,
  fakeClient,
  memoryStore,
  testSettings,
  type FakeCall,
} from './fakes.ts'

describe('custom instructions', () => {
  it('always includes the math formatting line', () => {
    const text = chatInstructions({ aboutUser: '  ', responseStyle: '' })
    expect(text).toContain('$…$')
    expect(text).not.toContain('user')
  })

  it('includes the current date and time', () => {
    const text = chatInstructions(
      { aboutUser: '', responseStyle: '' },
      new Date(2026, 9, 23, 9, 30),
    )
    expect(text).toContain(
      'The current date and time is Friday, October 23, 2026 at 9:30 AM (',
    )
  })

  it('adds what the user wrote, trimmed', () => {
    const text = chatInstructions({
      aboutUser: ' I write Rust. ',
      responseStyle: 'Be brief.',
    })
    expect(text).toContain('wants you to know about them:\nI write Rust.')
    expect(text).toContain('wants you to respond:\nBe brief.')
  })

  it('sends them with chat turns, not with title requests', async () => {
    const calls: FakeCall[] = []
    const titleCalls: { instructions?: string | null }[] = []
    const store = memoryStore()
    const chat = new ChatService(
      fakeClient(answerEvents('a'), calls, { titleCalls }),
      store,
      testSettings('m', { responseStyle: 'Be brief.' }),
    )
    await drain(chat.runTurn(store.createConversation().id, { text: 'q' }))
    expect(calls[0]!.params.instructions).toContain('Be brief.')
    expect(titleCalls[0]!.instructions).not.toContain('Be brief.')
  })
})
