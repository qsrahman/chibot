import { describe, expect, it } from 'vitest'
import type { ResponseFunctionToolCall } from 'openai/resources/responses/responses'
import { TOOL_STOPPED, ToolRegistry } from '../../src/server/tool-registry.ts'
import { EchoTool } from './fakes.ts'

const call = (name: string, args: string): ResponseFunctionToolCall => ({
  type: 'function_call',
  call_id: 'call_1',
  name,
  arguments: args,
})

const context = { conversationId: 'c' }

describe('ToolRegistry', () => {
  it('declares tools as strict JSON-Schema functions', () => {
    expect(new ToolRegistry([new EchoTool()]).declarations()).toEqual([
      {
        type: 'function',
        name: 'echo',
        description: 'Echoes text back.',
        strict: true,
        parameters: expect.objectContaining({
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        }),
      },
    ])
  })

  it('rejects duplicate names', () => {
    expect(() => new ToolRegistry([new EchoTool(), new EchoTool()])).toThrow(
      'Duplicate tool name: echo',
    )
  })

  it('runs a call with validated arguments', async () => {
    const registry = new ToolRegistry([new EchoTool()])
    expect(await registry.run(call('echo', '{"text":"hi"}'), context)).toBe(
      'echo: hi',
    )
  })

  it('reports problems to the model instead of throwing', async () => {
    const registry = new ToolRegistry([new EchoTool()])
    expect(await registry.run(call('nope', '{}'), context)).toBe(
      'Error: there is no tool named "nope".',
    )
    expect(await registry.run(call('echo', '{'), context)).toBe(
      'Error: the arguments are not valid JSON.',
    )
    expect(await registry.run(call('echo', '{"text":1}'), context)).toMatch(
      /^Error: invalid arguments: .*text/s,
    )
    expect(await registry.run(call('echo', '{"text":"fail"}'), context)).toBe(
      'Error: it failed',
    )
  })

  it('does not run a call once stopped', async () => {
    const tool = new EchoTool()
    const registry = new ToolRegistry([tool])
    expect(
      await registry.run(call('echo', '{"text":"hi"}'), {
        conversationId: 'c',
        signal: AbortSignal.abort(),
      }),
    ).toBe(TOOL_STOPPED)
    expect(tool.runs).toEqual([])
  })
})
