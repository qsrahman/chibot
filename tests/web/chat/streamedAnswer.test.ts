import { describe, expect, it } from 'vitest'
import type { TurnEvent } from '../../../src/web/chat/api.ts'
import {
  applyEvent,
  startAnswer,
  turnSoFar,
  type StreamedAnswer,
} from '../../../src/web/chat/streamedAnswer.ts'
import type { Question } from '../../../src/web/chat/turns.ts'

const ev = (event: object) => event as unknown as TurnEvent

/** Applies `events` in order, returning the answer and every effect. */
function run(events: object[], from: StreamedAnswer = startAnswer()) {
  let streamed = from
  const effects: unknown[] = []
  const changes: boolean[] = []
  for (const event of events) {
    const applied = applyEvent(streamed, ev(event))
    streamed = applied.streamed
    changes.push(applied.changed)
    if (applied.effect) effects.push(applied.effect)
  }
  return { streamed, effects, changes }
}

const call = (id: string, name = 'echo') => ({
  type: 'response.output_item.added',
  item: { type: 'function_call', call_id: id, name, arguments: '' },
})

describe('applyEvent', () => {
  it('appends text, and says to show it', () => {
    const { streamed, changes } = run([
      { type: 'response.output_text.delta', delta: 'Hi' },
      { type: 'response.output_text.delta', delta: ' there' },
    ])
    expect(streamed.text).toBe('Hi there')
    expect(changes).toEqual([true, true])
  })

  it('does not change the answer it was given', () => {
    const before = startAnswer()
    applyEvent(before, ev({ type: 'response.output_text.delta', delta: 'x' }))
    expect(before).toEqual(startAnswer())
  })

  it('starts from what an approved turn already had', () => {
    const before = startAnswer({
      itemId: 1,
      text: 'So far',
      thinking: 'Hmm',
      tools: [{ callId: 'a', name: 'echo', arguments: '{}', output: null }],
      usage: null,
      lastUsage: null,
      model: null,
      versions: null,
      incomplete: false,
    })
    expect(before).toMatchObject({ text: 'So far', thinking: 'Hmm' })
    expect(before.tools).toHaveLength(1)
  })

  describe('reasoning summaries', () => {
    const delta = (summary_index: number, text: string) => ({
      type: 'response.reasoning_summary_text.delta',
      summary_index,
      delta: text,
    })

    it('keeps one part together and starts a paragraph for the next', () => {
      const { streamed } = run([
        delta(0, 'Look'),
        delta(0, 'ing'),
        delta(1, 'Next'),
      ])
      expect(streamed.thinking).toBe('Looking\n\nNext')
    })

    it('starts a paragraph when the model thinks again after a tool call', () => {
      const { streamed } = run([
        delta(0, 'First'),
        { type: 'response.output_item.added', item: { type: 'reasoning' } },
        delta(0, 'Second'),
      ])
      expect(streamed.thinking).toBe('First\n\nSecond')
      expect(streamed.newThoughts).toBe(false)
    })

    it('needs no paragraph break before the first words', () => {
      const { streamed } = run([
        { type: 'response.output_item.added', item: { type: 'reasoning' } },
        delta(2, 'Start'),
      ])
      expect(streamed.thinking).toBe('Start')
    })
  })

  describe('tool calls', () => {
    it('adds a call, then its arguments, then its output', () => {
      const { streamed, changes } = run([
        call('c1'),
        {
          type: 'response.output_item.done',
          item: { type: 'function_call', call_id: 'c1', arguments: '{"a":1}' },
        },
        { type: 'chibot.tool_output', call_id: 'c1', output: 'echo: 1' },
      ])
      expect(streamed.tools).toEqual([
        { callId: 'c1', name: 'echo', arguments: '{"a":1}', output: 'echo: 1' },
      ])
      expect(changes).toEqual([true, true, true])
    })

    it('changes only the call it names', () => {
      const { streamed } = run([
        call('c1'),
        call('c2'),
        { type: 'chibot.tool_output', call_id: 'c2', output: 'two' },
      ])
      expect(streamed.tools.map((t) => t.output)).toEqual([null, 'two'])
    })

    it('does not show a finished item that is not a call', () => {
      const { changes } = run([
        {
          type: 'response.output_item.done',
          item: { type: 'message' },
        },
      ])
      expect(changes).toEqual([false])
    })

    it('makes a message after tool calls a new paragraph, but not the first', () => {
      const message = {
        type: 'response.output_item.added',
        item: { type: 'message' },
      }
      const text = (delta: string) => ({
        type: 'response.output_text.delta',
        delta,
      })
      const { streamed } = run([
        message,
        text('One.'),
        call('c1'),
        message,
        text('Two.'),
      ])
      expect(streamed.text).toBe('One.\n\nTwo.')
    })
  })

  describe('effects', () => {
    const output = (...types: string[]) => ({
      type: 'response.completed',
      response: { output: types.map((type) => ({ type })) },
    })

    it('says the answer is saved when a response completes without tool calls', () => {
      expect(run([output('message')]).effects).toEqual([{ type: 'answered' }])
      expect(
        run([{ ...output('message'), type: 'response.incomplete' }]).effects,
      ).toEqual([{ type: 'answered' }])
    })

    it('waits for the next response when tool calls follow', () => {
      expect(run([output('reasoning', 'function_call')]).effects).toEqual([])
    })

    it('says the turn is waiting for approval', () => {
      expect(run([{ type: 'chibot.approval', calls: [] }]).effects).toEqual([
        { type: 'approval' },
      ])
    })

    it('reports errors, with the request id when there is one', () => {
      expect(
        run([
          { type: 'chibot.error', message: 'Nope', requestId: 'req_1' },
          { type: 'chibot.error', message: 'Again' },
          { type: 'response.failed', response: { error: { message: 'Boom' } } },
          { type: 'response.failed', response: {} },
          { type: 'error', message: 'Stream broke' },
        ]).effects,
      ).toEqual([
        { type: 'error', message: 'Nope (request req_1)' },
        { type: 'error', message: 'Again' },
        { type: 'error', message: 'Boom' },
        { type: 'error', message: 'The response failed.' },
        { type: 'error', message: 'Stream broke' },
      ])
    })

    it('ignores events it does not use', () => {
      const { streamed, effects, changes } = run([
        { type: 'response.created' },
        { type: 'chibot.title', title: 'A title' },
      ])
      expect(streamed).toEqual(startAnswer())
      expect(effects).toEqual([])
      expect(changes).toEqual([false, false])
    })
  })
})

describe('turnSoFar', () => {
  const question = {
    itemId: null,
    parentId: null,
    text: 'Hi',
    attachments: [],
    versions: null,
  } as Question

  it('has no answer until something has streamed', () => {
    expect(turnSoFar(question, startAnswer(), 'pending')).toEqual({
      key: 'pending',
      question,
      compaction: null,
      answer: null,
    })
  })

  it('shows text, thinking or a tool call as the answer', () => {
    const { streamed } = run([
      { type: 'response.output_text.delta', delta: 'Hello' },
      call('c1'),
    ])
    expect(turnSoFar(question, streamed, 'k').answer).toMatchObject({
      itemId: null,
      text: 'Hello',
      tools: [{ callId: 'c1' }],
    })
    const thinkingOnly = run([
      {
        type: 'response.reasoning_summary_text.delta',
        summary_index: 0,
        delta: 'Hmm',
      },
    ]).streamed
    expect(turnSoFar(question, thinkingOnly, 'k').answer).not.toBeNull()
  })
})
