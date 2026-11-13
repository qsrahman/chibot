import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResponseFunctionToolCall } from 'openai/resources/responses/responses'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatInstructions } from '../../../src/server/chat/prompts.ts'
import { openDatabase } from '../../../src/server/database.ts'
import type { FileStore } from '../../../src/server/file-store.ts'
import { McpServers } from '../../../src/server/mcp/mcp-servers.ts'
import {
  TOOL_STOPPED,
  ToolRegistry,
} from '../../../src/server/tool-registry.ts'
import { mcpTools, toOutput } from '../../../src/server/mcp/mcp-tool.ts'
import { PNG } from '../../fixtures/mcp-server.ts'
import { EchoTool, testFiles } from '../fakes.ts'

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
  const dir = mkdtempSync(join(tmpdir(), 'chibot-mcp-'))
  /** Written by the fixture's slow tool when a call reaches it. */
  const started = join(dir, 'started')
  beforeAll(async () => {
    servers = new McpServers({
      fixture: {
        type: 'local',
        command: process.execPath,
        args: [join(import.meta.dirname, '../../fixtures/mcp-server.ts')],
        env: { CHIBOT_SLOW_MARKER: started },
      },
    })
    await servers.start()
    files = testFiles(openDatabase(':memory:'))
    registry = new ToolRegistry([new EchoTool()], mcpTools(servers, files))
  })
  afterAll(async () => {
    await servers.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const context = { conversationId: 'chat-1' }

  it('are not offered while switched off in the server’s entry', async () => {
    const off = new McpServers({
      fixture: {
        type: 'local',
        command: process.execPath,
        args: [join(import.meta.dirname, '../../fixtures/mcp-server.ts')],
        disabledTools: ['echo'],
        ask: true,
      },
    })
    await off.start()
    try {
      const tools = new ToolRegistry([], mcpTools(off, files))
      expect(tools.get('fixture__echo')!.unavailable()).toBe(
        'Switched off in Settings → Tools',
      )
      expect(tools.get('fixture__slow')!.unavailable()).toBeNull()
      // The entry's `ask` asks for every tool of the server.
      expect(tools.get('fixture__slow')!.requiresApproval).toBe(true)
    } finally {
      await off.close()
    }
  })

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

  it('give the model what a server says about them only when asked to', async () => {
    // Not asked for (the entry has no `instructions`): nothing.
    expect(registry.get('fixture__echo')!.instructions({} as never)).toBeNull()
    const asking = new McpServers({
      fixture: {
        type: 'local',
        command: process.execPath,
        args: [join(import.meta.dirname, '../../fixtures/mcp-server.ts')],
        instructions: true,
      },
    })
    await asking.start()
    try {
      const tools = new ToolRegistry([], mcpTools(asking, files))
      const notes = tools.get('fixture__echo')!.instructions({} as never)
      expect(notes).toBe(
        '<mcp_server name="fixture">\nUse echo to repeat what the user says.\n</mcp_server>',
      )
      // Each of the server's tools says it; the chat's instructions show it once.
      const same = tools.get('fixture__slow')!.instructions({} as never)
      expect(same).toBe(notes)
      const text = chatInstructions(
        { aboutUser: '', responseStyle: '' },
        { tools: true, toolInstructions: [notes, same, null] },
      )
      expect(text.split('Use echo to repeat').length).toBe(2)
    } finally {
      await asking.close()
    }
  })

  it('ask first only for servers set to', async () => {
    expect(registry.get('fixture__echo')!.requiresApproval).toBe(false)
    const asking = new McpServers({
      fixture: {
        type: 'local',
        command: process.execPath,
        args: [join(import.meta.dirname, '../../fixtures/mcp-server.ts')],
        ask: true,
      },
    })
    await asking.start()
    try {
      const tools = new ToolRegistry([], mcpTools(asking, files))
      expect(tools.get('fixture__echo')!.requiresApproval).toBe(true)
    } finally {
      await asking.close()
    }
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
    const output = expect(
      registry.run(call('fixture__slow'), {
        ...context,
        signal: stop.signal,
      }),
    ).resolves.toBe(TOOL_STOPPED)
    // Cancel once the server has the call, rather than on a timer that may
    // fire before it starts.
    await vi.waitFor(() => expect(existsSync(started)).toBe(true))
    stop.abort()
    await output
  })
})

describe('MCP results', () => {
  const files = testFiles(openDatabase(':memory:'))
  const output = (result: Parameters<typeof toOutput>[0]) =>
    toOutput(result, files, 'chat-1')

  it('use structured content when there’s no content', () => {
    // The SDK's type says `content` is required, but its schema (and so any
    // server) may send a result without it.
    const withoutContent = (result: object) =>
      result as Parameters<typeof toOutput>[0]
    expect(output(withoutContent({ structuredContent: { temp: 21 } }))).toBe(
      '{"temp":21}',
    )
    expect(output(withoutContent({}))).toBe('(no output)')
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

  it('keep no files when the call failed', () => {
    const before = files.ofConversation('chat-1').length
    expect(() =>
      output({
        isError: true,
        content: [
          { type: 'image', data: PNG, mimeType: 'image/png' },
          { type: 'text', text: 'it broke' },
        ],
      }),
    ).toThrow('it broke')
    expect(files.ofConversation('chat-1')).toHaveLength(before)
  })

  it('are cut when long', () => {
    const text = output({
      content: [{ type: 'text', text: 'x'.repeat(50_000) }],
    })
    expect(text).toHaveLength(40_000 + '\n\n[truncated]'.length)
  })
})
