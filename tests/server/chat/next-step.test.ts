import { beforeEach, describe, expect, it } from 'vitest'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses'
import type { ConversationStore } from '../../../src/server/conversations/index.ts'
import { ToolRegistry } from '../../../src/server/tool-registry.ts'
import { SuggestNextStepTool } from '../../../src/server/tools/next-step.ts'
import {
  answerEvents,
  callEvents,
  drain,
  memoryStore,
  testChat,
  usage,
  type FakeCall,
} from '../fakes.ts'

const card = {
  title: 'Weekly learning plan',
  description: 'Turn these into a 16-week plan',
  button: 'Create plan',
  prompt: 'Turn these into a 16-week plan with milestones',
}

/** One response: the written answer, then the call (as a model that follows the instructions makes it). */
function answerThenCard(args: unknown): ResponseStreamEvent[] {
  const [, completed] = answerEvents('Here are three projects.').slice(-2)
  const call = {
    id: 'fc_0',
    type: 'function_call',
    status: 'completed',
    call_id: 'call_card',
    name: 'suggest_next_step',
    arguments: JSON.stringify(args),
  }
  const message = (completed as unknown as { response: { output: unknown[] } })
    .response.output[0]
  return [
    { type: 'response.output_text.delta', delta: 'Here are three projects.' },
    { type: 'response.output_item.done', item: call },
    {
      type: 'response.completed',
      response: { output: [message, call], usage },
    },
  ] as unknown as ResponseStreamEvent[]
}

describe('the next-step tool', () => {
  let store: ConversationStore
  let conversationId: string
  beforeEach(() => {
    store = memoryStore()
    conversationId = store.createConversation().id
  })
  const chatWith = (
    events: Parameters<typeof testChat>[0],
    calls: FakeCall[],
  ) =>
    testChat(events, {
      store,
      calls,
      tools: new ToolRegistry([new SuggestNextStepTool()]),
    })

  it('ends the turn after the answer and saves the card with it', async () => {
    const calls: FakeCall[] = []
    const events = await drain(
      chatWith(answerThenCard(card), calls).runTurn(conversationId, {
        text: 'Rank these',
      }),
    )

    // No second request: nothing is added after the card.
    expect(calls).toHaveLength(1)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'chibot.tool_output',
        call_id: 'call_card',
      }),
    )
    expect(store.getPath(conversationId).map((i) => i.data.type)).toEqual([
      undefined,
      'message',
      'function_call',
      'function_call_output',
    ])
    // The next message continues from a valid history.
    const next: FakeCall[] = []
    await drain(
      chatWith(answerEvents('Sure'), next).runTurn(conversationId, {
        text: 'Yes please',
      }),
    )
    expect(next[0]!.params.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'function_call_output' }),
      ]),
    )
  })

  it('offers the tool with an instruction to call it after the answer', async () => {
    const calls: FakeCall[] = []
    await drain(
      chatWith(answerEvents('Hi'), calls).runTurn(conversationId, {
        text: 'Hi',
      }),
    )
    expect(calls[0]!.params.tools).toEqual([
      expect.objectContaining({ name: 'suggest_next_step' }),
    ])
    expect(calls[0]!.params.instructions).toContain('suggest_next_step')
  })

  it('shows nothing and changes nothing when the model ignores it', async () => {
    const calls: FakeCall[] = []
    await drain(
      chatWith(answerEvents('Plain answer'), calls).runTurn(conversationId, {
        text: 'Hi',
      }),
    )
    expect(calls).toHaveLength(1)
    expect(store.getPath(conversationId).map((i) => i.data.type)).toEqual([
      undefined,
      'message',
    ])
  })

  it('asks again when the model calls it before writing any answer', async () => {
    const calls: FakeCall[] = []
    await drain(
      chatWith(
        (n) =>
          n === 0
            ? callEvents({ name: 'suggest_next_step', args: card })
            : answerEvents('Now the answer'),
        calls,
      ).runTurn(conversationId, { text: 'Hi' }),
    )
    expect(calls).toHaveLength(2)
  })

  it('answers malformed input with an error the model can see, without breaking the turn', async () => {
    const calls: FakeCall[] = []
    const events = await drain(
      chatWith(answerThenCard({ title: 'Only a title' }), calls).runTurn(
        conversationId,
        { text: 'Hi' },
      ),
    )
    expect(calls).toHaveLength(1)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'chibot.tool_output',
        output: expect.stringMatching(/^Error: invalid arguments/),
      }),
    )
  })

  it('refuses blank fields', async () => {
    await expect(
      new SuggestNextStepTool().run({ ...card, prompt: '  ' }),
    ).rejects.toThrow('prompt is empty')
  })
})
