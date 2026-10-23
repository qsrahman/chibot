import { beforeEach, describe, expect, it } from 'vitest'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses'
import { z } from 'zod'
import { ChatService, MAX_STEPS } from '../../src/server/chat-service.ts'
import type { ConversationStore } from '../../src/server/conversation-store.ts'
import { Tool } from '../../src/server/tool.ts'
import {
  TOOL_DENIED,
  TOOL_STOPPED,
  ToolRegistry,
} from '../../src/server/tool-registry.ts'
import { pendingCalls } from '../../src/shared/tools.ts'
import {
  answerEvents,
  callEvents,
  drain,
  EchoTool,
  fakeClient,
  memoryStore,
  testSettings,
  type FakeCall,
} from './fakes.ts'

describe('ChatService tools', () => {
  let store: ConversationStore
  let conversationId: string
  beforeEach(() => {
    store = memoryStore()
    conversationId = store.createConversation().id
  })

  const chatWith = (
    events: Parameters<typeof fakeClient>[0],
    calls: FakeCall[],
    tools: Tool[] = [new EchoTool()],
  ) =>
    new ChatService(
      fakeClient(events, calls),
      store,
      testSettings(),
      new ToolRegistry(tools),
    )

  it('runs the calls and asks the model again with their outputs', async () => {
    const calls: FakeCall[] = []
    const chat = chatWith(
      (n) =>
        n === 0 ? callEvents({ args: { text: 'hi' } }) : answerEvents('Done'),
      calls,
    )

    const events = await drain(chat.runTurn(conversationId, { text: 'Go' }))

    expect(events).toContainEqual({
      type: 'chibot.tool_output',
      call_id: 'call_0',
      output: 'echo: hi',
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.params.tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'echo' }),
    ])
    expect(calls[1]!.params.input).toEqual([
      { role: 'user', content: 'Go' },
      expect.objectContaining({ type: 'function_call', call_id: 'call_0' }),
      { type: 'function_call_output', call_id: 'call_0', output: 'echo: hi' },
    ])
    expect(store.getPath(conversationId).map((i) => i.data.type)).toEqual([
      undefined,
      'function_call',
      'function_call_output',
      'message',
    ])
  })

  it('sends no tools when none are registered', async () => {
    const calls: FakeCall[] = []
    await drain(
      chatWith(answerEvents('Hi'), calls, []).runTurn(conversationId, {
        text: 'Hi',
      }),
    )
    expect(calls[0]!.params).not.toHaveProperty('tools')
  })

  it('leaves out tools switched off in Settings', async () => {
    const calls: FakeCall[] = []
    const chat = new ChatService(
      fakeClient(answerEvents('Hi'), calls),
      store,
      testSettings('m', { disabledTools: ['echo'] }),
      new ToolRegistry([new EchoTool()]),
    )
    await drain(chat.runTurn(conversationId, { text: 'Hi', tool: 'echo' }))
    expect(calls[0]!.params).not.toHaveProperty('tools')
    expect(calls[0]!.params).not.toHaveProperty('tool_choice')
  })

  it('forces a chosen tool on the first request only', async () => {
    const calls: FakeCall[] = []
    const chat = chatWith(
      (n) =>
        n === 0 ? callEvents({ args: { text: 'hi' } }) : answerEvents('Done'),
      calls,
    )
    await drain(chat.runTurn(conversationId, { text: 'Go', tool: 'echo' }))
    expect(calls[0]!.params.tool_choice).toEqual({
      type: 'function',
      name: 'echo',
    })
    expect(calls[1]!.params).not.toHaveProperty('tool_choice')
  })

  it('returns tool errors to the model', async () => {
    const calls: FakeCall[] = []
    const chat = chatWith(
      (n) =>
        n === 0
          ? callEvents({ args: { text: 'fail' } })
          : answerEvents('Sorry'),
      calls,
    )
    await drain(chat.runTurn(conversationId, { text: 'Go' }))
    expect(calls[1]!.params.input).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_0',
      output: 'Error: it failed',
    })
  })

  it('stops calling tools after MAX_STEPS requests', async () => {
    const calls: FakeCall[] = []
    const tool = new EchoTool()
    const chat = chatWith(
      () => callEvents({ args: { text: 'again' } }),
      calls,
      [tool],
    )

    await drain(chat.runTurn(conversationId, { text: 'Loop' }))

    expect(calls).toHaveLength(MAX_STEPS)
    expect(calls.at(-1)!.params.tool_choice).toBe('none')
    expect(calls.at(-2)!.params).not.toHaveProperty('tool_choice')
    expect(tool.runs).toHaveLength(MAX_STEPS - 1)
    // The last call is answered too, so the history stays valid input.
    expect(store.getPath(conversationId).at(-1)!.data).toEqual({
      type: 'function_call_output',
      call_id: 'call_0',
      output: 'Error: too many tool calls in one answer.',
    })
  })

  it('answers a call stopped mid-run, so the chat keeps working', async () => {
    const controller = new AbortController()
    class SlowTool extends Tool {
      readonly name = 'echo'
      readonly label = 'Slow'
      readonly description = 'Waits until stopped.'
      readonly parameters = z.object({ text: z.string() })
      async run(_: unknown, { signal }: { signal?: AbortSignal }) {
        controller.abort()
        signal?.throwIfAborted()
        return 'never'
      }
    }
    const calls: FakeCall[] = []
    const chat = chatWith(callEvents({ args: { text: 'x' } }), calls, [
      new SlowTool(),
    ])

    await expect(
      drain(chat.runTurn(conversationId, { text: 'Go' }, controller.signal)),
    ).rejects.toThrow()

    expect(calls).toHaveLength(1)
    expect(store.getPath(conversationId).at(-1)!.data).toEqual({
      type: 'function_call_output',
      call_id: 'call_0',
      output: TOOL_STOPPED,
    })
  })
})

describe('ChatService approvals', () => {
  let store: ConversationStore
  let conversationId: string
  let tool: EchoTool
  let calls: FakeCall[]
  let chat: ChatService
  beforeEach(() => {
    store = memoryStore()
    conversationId = store.createConversation().id
    tool = new EchoTool({ requiresApproval: true })
    calls = []
    chat = new ChatService(
      fakeClient(
        (n) =>
          n === 0
            ? callEvents(
                { args: { text: 'a' }, callId: 'call_a' },
                { args: { text: 'b' }, callId: 'call_b' },
              )
            : answerEvents('Done'),
        calls,
      ),
      store,
      testSettings(),
      new ToolRegistry([tool]),
    )
  })

  const path = () => store.getPath(conversationId).map((i) => i.data)

  it('ends the turn with the calls waiting for approval', async () => {
    const events = await drain(chat.runTurn(conversationId, { text: 'Go' }))
    expect(events).toContainEqual({
      type: 'chibot.approval',
      calls: [
        expect.objectContaining({ call_id: 'call_a' }),
        expect.objectContaining({ call_id: 'call_b' }),
      ],
    })
    expect(tool.runs).toEqual([])
    expect(calls).toHaveLength(1)
    expect(pendingCalls(path())).toHaveLength(2)
  })

  it('runs approved calls, denies the rest and continues', async () => {
    await drain(chat.runTurn(conversationId, { text: 'Go' }))
    const events = await drain(
      chat.runTurn(conversationId, {
        approvals: { call_a: true, call_b: false },
      }),
    )

    expect(tool.runs).toEqual(['a'])
    expect(events.filter((e) => e.type === 'chibot.tool_output')).toEqual([
      { type: 'chibot.tool_output', call_id: 'call_a', output: 'echo: a' },
      { type: 'chibot.tool_output', call_id: 'call_b', output: TOOL_DENIED },
    ])
    expect(calls).toHaveLength(2)
    expect(path().at(-1)).toMatchObject({ type: 'message' })
    expect(pendingCalls(path())).toEqual([])
  })

  it('denies waiting calls when a new message is sent instead', async () => {
    await drain(chat.runTurn(conversationId, { text: 'Go' }))
    await drain(chat.runTurn(conversationId, { text: 'Never mind' }))

    expect(tool.runs).toEqual([])
    expect(calls[1]!.params.input).toEqual([
      { role: 'user', content: 'Go' },
      expect.objectContaining({ call_id: 'call_a' }),
      expect.objectContaining({ call_id: 'call_b' }),
      { type: 'function_call_output', call_id: 'call_a', output: TOOL_DENIED },
      { type: 'function_call_output', call_id: 'call_b', output: TOOL_DENIED },
      { role: 'user', content: 'Never mind' },
    ])
  })
})

describe("approval 'after-untrusted'", () => {
  const page = () => new EchoTool({ name: 'page', untrustedOutput: true })
  const remember = () =>
    new EchoTool({ name: 'remember', requiresApproval: 'after-untrusted' })

  async function run(events: (call: number) => ResponseStreamEvent[]) {
    const store = memoryStore()
    const tools = [page(), remember()]
    const chat = new ChatService(
      fakeClient(events),
      store,
      testSettings(),
      new ToolRegistry(tools),
    )
    const { id } = store.createConversation()
    const output = await drain(chat.runTurn(id, { text: 'Go' }))
    return { output, runs: tools.map((t) => t.runs) }
  }

  it("doesn't ask in a chat without untrusted content", async () => {
    const { output, runs } = await run((n) =>
      n === 0
        ? callEvents({ name: 'remember', args: { text: 'fact' } })
        : answerEvents('ok'),
    )
    expect(output.some((e) => e.type === 'chibot.approval')).toBe(false)
    expect(runs).toEqual([[], ['fact']])
  })

  it('asks once a tool with untrusted output ran in the chat', async () => {
    const { output, runs } = await run((n) =>
      n === 0
        ? callEvents({ name: 'page', args: { text: 'web' } })
        : n === 1
          ? callEvents({ name: 'remember', args: { text: 'planted' } })
          : answerEvents('ok'),
    )
    expect(output).toContainEqual({
      type: 'chibot.approval',
      calls: [expect.objectContaining({ name: 'remember' })],
    })
    expect(runs).toEqual([['web'], []])
  })
})
