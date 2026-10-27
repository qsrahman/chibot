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
  it('declares a tool as a strict JSON-Schema function', () => {
    expect(new EchoTool().declaration).toEqual({
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
    })
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
    expect(await registry.run(call('echo', '{}'), context, ['echo'])).toBe(
      'Error: there is no tool named "echo".',
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

  describe('needsApproval', () => {
    const registry = new ToolRegistry([
      new EchoTool({ name: 'plain' }),
      new EchoTool({ name: 'always', requiresApproval: true }),
      new EchoTool({ name: 'later', requiresApproval: 'after-untrusted' }),
      new EchoTool({ name: 'page', untrustedOutput: true }),
    ])
    const made = (name: string) => call(name, '{}')
    const history = (...names: string[]) => names.map(made)

    it('asks always for tools that always ask, never for plain ones', () => {
      expect(registry.needsApproval(made('always'), [])).toBe(true)
      expect(registry.needsApproval(made('always'), history('page'))).toBe(true)
      expect(registry.needsApproval(made('plain'), history('page'))).toBe(false)
      // Unknown tools never wait: running them just reports the error.
      expect(registry.needsApproval(made('nope'), history('page'))).toBe(false)
    })

    it("asks for 'after-untrusted' tools only once untrusted output is in", () => {
      expect(registry.needsApproval(made('later'), [])).toBe(false)
      expect(registry.needsApproval(made('later'), history('plain'))).toBe(
        false,
      )
      expect(
        registry.needsApproval(made('later'), history('plain', 'page')),
      ).toBe(true)
      // Messages alone aren't tool calls.
      expect(
        registry.needsApproval(made('later'), [
          { role: 'user', content: 'page' },
        ]),
      ).toBe(false)
    })
  })
})
