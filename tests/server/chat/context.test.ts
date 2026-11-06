import { describe, expect, it } from 'vitest'
import type { ResponseInputItem } from 'openai/resources/responses/responses'
import {
  compactionFor,
  contextTokens,
  cutPoint,
  estimateText,
  fromCompaction,
  prune,
  pruningSuffices,
  serialize,
  keepTokens,
} from '../../../src/server/chat/context.ts'
import { triggerAt } from '../../../src/shared/context.ts'
import type { Compaction, StoredItem } from '../../../src/shared/types.ts'

let nextId = 1
const stored = (
  data: ResponseInputItem,
  usage: StoredItem['usage'] = null,
): StoredItem => ({
  id: nextId++,
  parentId: null,
  data,
  usage,
  model: null,
  siblingIds: [],
  createdAt: 0,
})
const user = (text: string) => stored({ role: 'user', content: text })
const assistant = (text: string) => stored({ role: 'assistant', content: text })
const call = (id: string) =>
  stored({
    type: 'function_call',
    call_id: id,
    name: 'lookup',
    arguments: '{"q":1}',
  })
const output = (id: string, text: string) =>
  stored({ type: 'function_call_output', call_id: id, output: text })
const used = (input: number, output = 0) =>
  ({ input_tokens: input, output_tokens: output }) as StoredItem['usage']
const compaction = (upToItemId: number, id = 1): Compaction => ({
  id,
  upToItemId,
  summary: 'notes',
  summaryModel: 'm',
  tokensBefore: 0,
  tokensAfter: 0,
  previousId: null,
  degraded: false,
  createdAt: 0,
})
const limits = {
  window: 32_000,
  compactAt: 75,
  reserve: 16_000,
  keepRecent: 15_000,
}

describe('context budget', () => {
  it('compacts at the lower of the percentage and the reserve', () => {
    expect(triggerAt(limits)).toBe(16_000)
    expect(triggerAt({ ...limits, window: 200_000 })).toBe(150_000)
    expect(triggerAt({ ...limits, window: 200_000, reserve: 80_000 })).toBe(
      120_000,
    )
  })

  it('keeps at most half the trigger verbatim', () => {
    expect(keepTokens(limits)).toBe(8000)
    expect(keepTokens({ ...limits, window: 200_000 })).toBe(15_000)
  })

  it('estimates 4 characters a token, more for CJK', () => {
    expect(estimateText('a'.repeat(400))).toBe(100)
    expect(estimateText('漢'.repeat(400))).toBe(300)
  })

  it('trusts the last reported usage and estimates what came after', () => {
    const items = [
      user('a'),
      assistant('b'),
      { ...user('c'), usage: used(5000, 200) },
      user('x'.repeat(400)),
    ]
    expect(contextTokens(items)).toBeGreaterThanOrEqual(5200 + 100)
    expect(contextTokens(items)).toBeLessThan(5200 + 140)
    // No usage anywhere: all of it is an estimate, plus any summary before it.
    const bare = [user('x'.repeat(4000))]
    expect(contextTokens(bare, 50)).toBeGreaterThan(1000)
  })
})

describe('cutPoint', () => {
  it('cuts at the start of a turn that keeps the newest tokens', () => {
    const items = [
      user('1'),
      assistant('a'.repeat(4000)),
      user('2'),
      assistant('b'.repeat(4000)),
      user('3'),
      assistant('c'.repeat(4000)),
    ]
    // About 1000 tokens an answer: the tail has at least what was asked for.
    expect(cutPoint(items, 900)).toBe(4)
    expect(cutPoint(items, 1500)).toBe(2)
    // More than fits before the last turn: summarize what can be.
    expect(cutPoint(items, 2500)).toBe(2)
  })

  it('never separates a tool call from its output', () => {
    const items = [
      user('1'),
      call('a'),
      output('a', 'x'.repeat(4000)),
      assistant('done'),
      user('2'),
      call('b'),
      output('b', 'y'.repeat(4000)),
      assistant('done'),
    ]
    for (const tokens of [100, 1100, 2100]) {
      const cut = cutPoint(items, tokens)
      if (cut === null) continue
      expect(items[cut]!.data.type).not.toBe('function_call_output')
      const before = items.slice(0, cut).map((i) => i.data)
      const calls = before.filter((d) => d.type === 'function_call')
      const outputs = before.filter((d) => d.type === 'function_call_output')
      expect(outputs).toHaveLength(calls.length)
    }
  })

  it('cuts inside a turn that is longer than the tail, between whole tool rounds', () => {
    // One user message, then rounds of 2 parallel calls with 1000-token outputs.
    const items = [user('Do it')]
    for (const round of ['a', 'b', 'c', 'd']) {
      items.push(
        call(`${round}1`),
        call(`${round}2`),
        output(`${round}1`, 'x'.repeat(4000)),
        output(`${round}2`, 'y'.repeat(4000)),
      )
    }
    const cut = cutPoint(items, 1000)!
    expect(cut).toBeGreaterThan(1)
    expect(items[cut]!.data.type).toBe('function_call')
    // Everything before it is whole rounds (a call's pair is not split).
    expect((cut - 1) % 4).toBe(0)
  })

  it('has nothing to summarize when the first turn is the newest', () => {
    expect(cutPoint([user('1'), assistant('a'.repeat(8000))], 100)).toBeNull()
  })
})

describe('compactions on a path', () => {
  it('uses the newest compaction whose cut is on the path', () => {
    const path = [user('1'), assistant('a'), user('2'), assistant('b')]
    const [first, , third] = path
    const older = compaction(first!.id, 1)
    const newer = compaction(third!.id, 2)
    expect(compactionFor(path, [older, newer])).toBe(newer)
    expect(compactionFor(path, [compaction(9999, 3)])).toBeNull()
    expect(compactionFor(path, [])).toBeNull()
  })

  it('starts the input with the summary and ignores OpenAI’s compaction items', () => {
    const path = [
      user('1'),
      assistant('a'),
      stored({ type: 'compaction', id: 'c', encrypted_content: 'x' }),
      user('2'),
    ]
    const { items, lead } = fromCompaction(path, compaction(path[1]!.id))
    expect(items.map((i) => i.data)).toEqual([path[3]!.data])
    expect(lead[0]).toMatchObject({ role: 'user' })
    expect(JSON.stringify(lead[0])).toContain('<conversation_summary>')
    // Without a compaction the whole path, minus the old kind of item.
    expect(fromCompaction(path, null).items).toHaveLength(3)
  })
})

describe('prune', () => {
  const big = 'x'.repeat(20_000)

  it('shortens big old tool results and keeps the newest items', () => {
    const items: ResponseInputItem[] = [
      { type: 'function_call_output', call_id: 'a', output: big },
      { type: 'function_call_output', call_id: 'b', output: big },
    ]
    const [old, recent] = prune(items, 1)
    expect((old as { output: string }).output).toContain(
      '[… 15000 characters hidden; run the tool again if you need them]',
    )
    expect((old as { output: string }).output.length).toBeLessThan(5200)
    expect(recent).toBe(items[1])
    // Small results are left alone.
    const small: ResponseInputItem = {
      type: 'function_call_output',
      call_id: 'c',
      output: 'ok',
    }
    expect(prune([small], 1)[0]).toBe(small)
  })

  it('replaces pictures but the newest two with a marker', () => {
    const picture = (id: string): ResponseInputItem => ({
      role: 'user',
      content: [
        { type: 'input_text', text: 'look' },
        { type: 'input_image', file_id: id, detail: 'auto' },
      ],
    })
    const items = [picture('1'), picture('2'), picture('3'), picture('4')]
    const pruned = prune(items, 4)
    expect(JSON.stringify(pruned[0])).toContain('[image]')
    expect(JSON.stringify(pruned[1])).toContain('[image]')
    expect(JSON.stringify(pruned[2])).toContain('input_image')
    expect(JSON.stringify(pruned[3])).toContain('input_image')
  })

  it('stands in for a summary only when it frees enough', () => {
    expect(pruningSuffices(5000, 20_000, 16_000, 32_000)).toBe(false) // under 20 % of the window
    expect(pruningSuffices(7000, 30_000, 16_000, 32_000)).toBe(false) // still over
    expect(pruningSuffices(7000, 22_000, 16_000, 32_000)).toBe(true)
  })
})

describe('serialize', () => {
  it('labels messages, tool calls and results, and cuts long results', () => {
    const text = serialize([
      { role: 'user', content: 'Fix `app.ts`' },
      { type: 'function_call', call_id: 'a', name: 'read', arguments: '{}' },
      { type: 'function_call_output', call_id: 'a', output: 'z'.repeat(5000) },
      { role: 'assistant', content: 'Done' },
    ])
    expect(text).toContain('[User] Fix `app.ts`')
    expect(text).toContain('[Tool call read({})]')
    expect(text).toMatch(/\[Tool result\] z{2000}… \[3000 more\]/)
    expect(text).toContain('[Assistant] Done')
  })
})
