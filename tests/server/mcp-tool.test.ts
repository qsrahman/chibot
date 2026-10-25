import { join } from 'node:path'
import type { ResponseFunctionToolCall } from 'openai/resources/responses/responses'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/server/database.ts'
import type { FileStore } from '../../src/server/file-store.ts'
import { McpServers } from '../../src/server/mcp-servers.ts'
import { TOOL_STOPPED, ToolRegistry } from '../../src/server/tool-registry.ts'
import { mcpTools, toOutput } from '../../src/server/tools/mcp-tool.ts'
import { PNG } from '../fixtures/mcp-server.ts'
import { EchoTool, testFiles } from './fakes.ts'

const call = (name: string, args = '{}'): ResponseFunctionToolCall => ({
  type: 'function_call',
  call_id: 'call_1',
  name,
  arguments: args,
})

describe('MCP tools', () => {
  let servers: McpServers
  let files: FileStore
  let registry: ToolRegistry
  beforeAll(async () => {
    servers = new McpServers(
      {
        fixture: {
          type: 'local',
          command: process.execPath,
          args: [join(import.meta.dirname, '../fixtures/mcp-server.ts')],
        },
      },
      { disabled: () => [] },
    )
    await servers.start()
    files = testFiles(openDatabase(':memory:'))
    registry = new ToolRegistry([new EchoTool()], mcpTools(servers, files))
  })
  afterAll(() => servers.close())
  const context = { conversationId: 'chat-1' }

  it('are offered beside chibot’s own, with the server’s schema', () => {
    expect(registry.tools.map((t) => t.name)).toContain('fixture__echo')
    const echo = registry.get('fixture__echo')!
    // The same object while the list stays.
    expect(registry.get('fixture__echo')).toBe(echo)
    expect(echo).toMatchObject({ label: 'Echo', untrustedOutput: true })
    expect(echo.requiresApproval).toBe(false)
    expect(echo.declaration).toEqual({
      type: 'function',
      name: 'fixture__echo',
      description: 'Repeats the text',
      strict: false,
      parameters: expect.objectContaining({
        type: 'object',
        properties: { text: { type: 'string' } },
      }),
    })
    expect(echo.declaration.parameters).not.toHaveProperty('$schema')
  })

  it('run through the registry', async () => {
    expect(
      await registry.run(call('fixture__echo', '{"text":"hi"}'), context),
    ).toBe('echo: hi')
    // The server checks the arguments.
    expect(await registry.run(call('fixture__echo'), context)).toMatch(
      /^Error: .*text/s,
    )
    expect(await registry.run(call('fixture__fail'), context)).toBe(
      'Error: it broke',
    )
  })

  it('keep images with the chat and tell the model they’re shown', async () => {
    const output = await registry.run(call('fixture__picture'), context)
    const { result, image_ids } = JSON.parse(output) as {
      result: string
      image_ids: string[]
    }
    expect(result).toBe('Here it is.\n\n[An image, shown to the user]')
    expect(files.get(image_ids[0]!)).toMatchObject({
      conversationId: 'chat-1',
      mime: 'image/png',
    })
    expect(files.read(image_ids[0]!).toString('base64')).toBe(PNG)
  })

  it('stop when the answer is stopped', async () => {
    const stop = new AbortController()
    const output = registry.run(call('fixture__slow'), {
      ...context,
      signal: stop.signal,
    })
    setTimeout(() => stop.abort(), 100)
    expect(await output).toBe(TOOL_STOPPED)
  })
})

describe('MCP results', () => {
  const files = testFiles(openDatabase(':memory:'))
  const output = (result: Parameters<typeof toOutput>[0]) =>
    toOutput(result, files, 'chat-1')

  it('use structured content when there’s no text', () => {
    expect(output({ content: [], structuredContent: { temp: 21 } })).toBe(
      '{"temp":21}',
    )
    expect(
      output({
        content: [{ type: 'text', text: 'warm' }],
        structuredContent: { temp: 21 },
      }),
    ).toBe('warm')
    expect(output({ content: [] })).toBe('(no output)')
  })

  it('describe what they can’t pass on', () => {
    expect(
      output({
        content: [
          { type: 'image', data: 'PHN2Zz4=', mimeType: 'image/svg+xml' },
          { type: 'resource_link', uri: 'file:///a.txt', name: 'a' },
          {
            type: 'resource',
            resource: { uri: 'file:///b.txt', text: 'b’s text' },
          },
        ],
      }),
    ).toBe(
      '[An image (image/svg+xml) that isn’t shown]\n\n[A link: file:///a.txt]\n\nb’s text',
    )
  })

  it('are cut when long', () => {
    const text = output({
      content: [{ type: 'text', text: 'x'.repeat(50_000) }],
    })
    expect(text).toHaveLength(40_000 + '\n\n[truncated]'.length)
  })
})
