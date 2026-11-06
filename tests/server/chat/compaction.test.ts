import OpenAI from 'openai'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ResponseCreateParams } from 'openai/resources/responses/responses'
import { SUMMARY_INSTRUCTIONS } from '../../../src/server/chat/prompts.ts'
import type { ConversationStore } from '../../../src/server/conversations/index.ts'
import {
  answerEvents,
  drain,
  memoryStore,
  testChatServices,
  testSettings,
  type FakeCall,
} from '../fakes.ts'

// A window of 2,000 tokens compacts at 1,500 and keeps 500 verbatim.
const small = {
  contextWindow: 2000,
  compactAt: 75,
  compactReserve: 0,
  keepRecent: 500,
}
const SUMMARY = '<analysis>x</analysis><summary>## Goal\nBuild it.</summary>'

describe('compaction', () => {
  let store: ConversationStore
  let id: string
  beforeEach(() => {
    store = memoryStore()
    id = store.createConversation().id
    // Four turns of about 700 tokens each, the last answer reporting 2,800.
    let leaf: number | null = null
    for (let i = 1; i <= 4; i++) {
      leaf = store.appendItems(id, leaf, [
        { role: 'user', content: `Question ${i} ${'q'.repeat(1400)}` },
      ])[0]!.id
      leaf = store
        .appendItems(
          id,
          leaf,
          [{ role: 'assistant', content: `Answer ${i} ${'a'.repeat(1400)}` }],
          {
            input_tokens: 700 * i * 2 - 700,
            output_tokens: 350,
            total_tokens: 0,
          } as never,
          'm',
        )
        .at(-1)!.id
    }
  })

  const summarizer =
    (outcome: string | Error = SUMMARY) =>
    (params: ResponseCreateParams) =>
      params.instructions === SUMMARY_INSTRUCTIONS ? outcome : 'A Title'
  // An answer that reports a context as big as the chat is.
  const bigAnswer = () => {
    const events = answerEvents('ok')
    const done = events.at(-1) as unknown as {
      response: { usage: object }
    }
    done.response.usage = {
      input_tokens: 5000,
      output_tokens: 50,
      total_tokens: 5050,
    }
    return events
  }
  const setup = (
    title: ReturnType<typeof summarizer>,
    overrides: object = small,
    extra: object = {},
  ) => {
    const calls: FakeCall[] = []
    const titleCalls: ResponseCreateParams[] = []
    const services = testChatServices(bigAnswer(), {
      store,
      calls,
      settings: testSettings('m', overrides),
      client: { title, titleCalls, ...extra },
    })
    return { ...services, calls, titleCalls }
  }
  const summaryCalls = (calls: ResponseCreateParams[]) =>
    calls.filter((p) => p.instructions === SUMMARY_INSTRUCTIONS)

  it('summarizes the start of a long chat before the request and sends the summary', async () => {
    const { chat, calls, titleCalls } = setup(summarizer())
    const events = await drain(chat.runTurn(id, { text: 'Next' }))

    const status = events.filter((e) => e.type === 'chibot.compaction')
    expect(status.map((e) => e.status)).toEqual(['started', 'done'])
    const compaction = store.compactions.list(id)[0]!
    expect(compaction).toMatchObject({
      summary: '## Goal\nBuild it.',
      summaryModel: 'm',
      degraded: false,
    })
    expect(compaction.tokensAfter).toBeLessThan(compaction.tokensBefore)

    // The summarizer got the old messages and no tools.
    const [request] = summaryCalls(titleCalls)
    expect(request).toMatchObject({ store: false, max_output_tokens: 8000 })
    expect(request).not.toHaveProperty('tools')
    // (This tiny window only fits the newest of them.)
    expect(String(request!.input)).toContain('[User] Question 3')

    // The chat request starts with the summary, then the messages after the cut.
    const input = calls[0]!.params.input as { role: string; content: string }[]
    expect(input[0]!.content).toContain(
      '<conversation_summary>\n## Goal\nBuild it.\n</conversation_summary>',
    )
    expect(JSON.stringify(input)).not.toContain('Question 1')
    expect(input.at(-1)).toEqual({ role: 'user', content: 'Next' })
    // The messages are all still saved.
    expect(store.getPath(id)).toHaveLength(8 + 2)
  })

  it('writes the summary with the summary model when one is set', async () => {
    const { chat, titleCalls } = setup(summarizer(), {
      ...small,
      summaryModel: 'small-one',
    })
    await drain(chat.runTurn(id, { text: 'Next' }))
    expect(summaryCalls(titleCalls)[0]).toMatchObject({ model: 'small-one' })
    expect(store.compactions.list(id)[0]!.summaryModel).toBe('small-one')
  })

  it('does nothing below the trigger, or with auto-compact off', async () => {
    for (const overrides of [
      { ...small, contextWindow: 100_000 },
      { ...small, autoCompact: false },
    ]) {
      const { chat, calls } = setup(summarizer(), overrides)
      const events = await drain(chat.runTurn(id, { text: 'Next' }))
      expect(events.some((e) => e.type === 'chibot.compaction')).toBe(false)
      expect(JSON.stringify(calls[0]!.params.input)).toContain('Question 1')
    }
    expect(store.compactions.list(id)).toEqual([])
  })

  it('keeps chatting when the summary fails, and stops trying after three in a row', async () => {
    const { chat, calls, titleCalls } = setup(summarizer(new Error('down')))
    for (let turn = 1; turn <= 4; turn++) {
      const events = await drain(chat.runTurn(id, { text: `Next ${turn}` }))
      const failed = events.filter(
        (e) => e.type === 'chibot.compaction' && e.status === 'failed',
      )
      expect(failed).toHaveLength(turn <= 3 ? 1 : 0)
    }
    expect(summaryCalls(titleCalls)).toHaveLength(3)
    // Every request still went out, with the whole history.
    expect(calls).toHaveLength(4)
    expect(JSON.stringify(calls[3]!.params.input)).toContain('Question 1')
    expect(store.compactions.list(id)).toEqual([])
  })

  it.each([
    ['no <summary> tag', 'just words'],
    ['an unclosed <summary>', '<summary>cut off'],
    ['an empty summary', '<summary>  </summary>'],
  ])('rejects %s', async (_name, reply) => {
    const { chat } = setup(summarizer(reply))
    const events = await drain(chat.runTurn(id, { text: 'Next' }))
    expect(
      events.some(
        (e) => e.type === 'chibot.compaction' && e.status === 'failed',
      ),
    ).toBe(true)
    expect(store.compactions.list(id)).toEqual([])
  })

  it('rejects a summary longer than what it replaces', async () => {
    const long = `<summary>${'word '.repeat(5000)}</summary>`
    const { chat } = setup(summarizer(long))
    await drain(chat.runTurn(id, { text: 'Next' }))
    expect(store.compactions.list(id)).toEqual([])
  })

  it('marks a summary that lost something the user quoted', async () => {
    store.appendItems(id, store.getPath(id).at(-1)!.id, [
      { role: 'user', content: 'Edit `src/keep-me.ts` ' + 'z'.repeat(300) },
    ])
    const { chat } = setup(summarizer())
    await drain(chat.runTurn(id, { text: 'Next' }))
    expect(store.compactions.list(id)[0]!.degraded).toBe(false)
    const quoting = store.getPath(id)
    // Quoted in the first turn: the summary above doesn't have it.
    store.appendItems(id, null, [
      { role: 'user', content: 'Open `lost/name.ts` ' + 'z'.repeat(2000) },
    ])
    expect(quoting.length).toBeGreaterThan(0)
  })

  it('summarizes again from the earlier summary', async () => {
    const { chat, titleCalls } = setup(summarizer())
    await drain(chat.runTurn(id, { text: 'Next' }))
    // The chat grows past the trigger again.
    let leaf = store.getConversation(id)!.currentLeafId
    for (let i = 5; i <= 8; i++) {
      leaf = store.appendItems(id, leaf, [
        { role: 'user', content: `Question ${i} ${'q'.repeat(1400)}` },
      ])[0]!.id
      leaf = store
        .appendItems(
          id,
          leaf,
          [{ role: 'assistant', content: `Answer ${i} ${'a'.repeat(1400)}` }],
          { input_tokens: 2400, output_tokens: 350, total_tokens: 0 } as never,
          'm',
        )
        .at(-1)!.id
    }
    await drain(chat.runTurn(id, { text: 'Again' }))
    const [first, second] = store.compactions.list(id)
    expect(second!.previousId).toBe(first!.id)
    const requests = summaryCalls(titleCalls)
    expect(String(requests[1]!.input)).toContain('Build it.')
    expect(String(requests[1]!.input)).not.toContain('Question 1 ')
  })

  it('undoes a compaction by deleting it', async () => {
    const { chat, calls } = setup(summarizer())
    await drain(chat.runTurn(id, { text: 'Next' }))
    const [compaction] = store.compactions.list(id)
    expect(store.compactions.delete(id, compaction!.id)).toBe(true)
    // Back to the whole history (still large, so it is summarized again).
    const { chat: again, calls: more } = setup(summarizer(), {
      ...small,
      autoCompact: false,
    })
    await drain(again.runTurn(id, { text: 'After undo' }))
    expect(JSON.stringify(more[0]!.params.input)).toContain('Question 1')
    expect(calls).toHaveLength(1)
  })

  it('compacts and asks again once when the server says the request is too long', async () => {
    const tooLong = new OpenAI.BadRequestError(
      400,
      { message: 'maximum context length exceeded' },
      'maximum context length exceeded',
      new Headers(),
    )
    const { chat, calls } = setup(
      summarizer(),
      { ...small, contextWindow: 100_000 },
      {
        // Until the start of the chat is gone.
        reject: (params: { input: unknown }) =>
          JSON.stringify(params.input).includes('Question 1')
            ? tooLong
            : undefined,
      },
    )
    const events = await drain(chat.runTurn(id, { text: 'Next' }))
    expect(
      events.filter((e) => e.type === 'chibot.compaction').map((e) => e.status),
    ).toEqual(['started', 'done'])
    expect(calls).toHaveLength(3) // refused twice (the second without options), then sent
    expect(JSON.stringify(calls[0]!.params.input)).toContain('Question 1')
    expect(JSON.stringify(calls[2]!.params.input)).toContain(
      '<conversation_summary>',
    )
  })

  it('shows the error when summarizing cannot help', async () => {
    const tooLong = new OpenAI.BadRequestError(
      400,
      { message: 'maximum context length exceeded' },
      'maximum context length exceeded',
      new Headers(),
    )
    const { chat } = setup(summarizer(new Error('down')), small, {
      reject: () => tooLong,
    })
    await expect(drain(chat.runTurn(id, { text: 'Next' }))).rejects.toBe(
      tooLong,
    )
  })

  it('manual compaction summarizes with the focus and reports when there is nothing to do', async () => {
    const { compactor, titleCalls } = setup(summarizer())
    const leaf = store.getConversation(id)!.currentLeafId!
    const job = compactor.prepare(id, leaf)!
    const compaction = await compactor.run(job, { focus: 'the auth bug' })
    expect(compaction.upToItemId).toBe(job.upToItemId)
    expect(String(summaryCalls(titleCalls)[0]!.input)).toContain(
      '<focus>\nthe auth bug\n</focus>',
    )
    // A chat with a single turn has nothing before it.
    const other = store.createConversation().id
    const first = store.appendItems(other, null, [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ])
    expect(compactor.prepare(other, first.at(-1)!.id)).toBeNull()
  })
})
