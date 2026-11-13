import { join } from 'node:path'
import type { ResponseFunctionToolCall } from 'openai/resources/responses/responses'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { McpServerConfig } from '../../../src/server/mcp/mcp-config.ts'
import { McpServers } from '../../../src/server/mcp/mcp-servers.ts'
import {
  ListMcpResourcesTool,
  ReadMcpResourceTool,
} from '../../../src/server/mcp/resource-tools.ts'
import { ToolRegistry } from '../../../src/server/tool-registry.ts'

const fixture: McpServerConfig = {
  type: 'local',
  command: process.execPath,
  args: [join(import.meta.dirname, '../../fixtures/mcp-server.ts')],
}
const context = { conversationId: 'chat-1' }
const call = (name: string, args: unknown): ResponseFunctionToolCall => ({
  type: 'function_call',
  call_id: 'c1',
  name,
  arguments: JSON.stringify(args),
})

describe('MCP resources', () => {
  let servers: McpServers
  let list: ListMcpResourcesTool
  let read: ReadMcpResourceTool
  beforeAll(async () => {
    servers = new McpServers({ fixture })
    await servers.start()
    list = new ListMcpResourcesTool(servers)
    read = new ReadMcpResourceTool(servers)
  })
  afterAll(() => servers.close())

  it('are known for a connected server that offers them', () => {
    expect(servers.resourceServers()).toEqual(['fixture'])
  })

  it('are listed with the way to read each, and the templates', async () => {
    const [one] = await servers.listResources(null)
    expect(one!.server).toBe('fixture')
    expect(one!.resources.map((r) => r.uri)).toEqual([
      'notes://readme',
      'notes://logo',
    ])
    expect(one!.templates.map((t) => t.uriTemplate)).toEqual(['note://{id}'])

    const text = await list.run({ server: null }, context)
    expect(text).toContain('Server fixture:')
    expect(text).toContain(
      '- notes://readme: Readme (text/plain): What the notes are for',
    )
    expect(text).toContain(
      '- template note://{id}: A note: One note, by its id',
    )
    expect(await list.run({ server: 'fixture' }, context)).toBe(text)
  })

  it('are read as text, and a file that is not text is only named', async () => {
    expect(
      await read.run({ server: 'fixture', uri: 'notes://readme' }, context),
    ).toBe('Notes live here.')
    // A resource named through a template.
    expect(
      await read.run({ server: 'fixture', uri: 'note://7' }, context),
    ).toBe('Note 7.')
    expect(
      await read.run({ server: 'fixture', uri: 'notes://logo' }, context),
    ).toBe('[A file (image/png) that isn’t shown]')
  })

  it('say what is wrong: no such server, or no such resource', async () => {
    await expect(
      read.run({ server: 'nobody', uri: 'notes://readme' }, context),
    ).rejects.toThrow(
      'nobody offers no resources; the servers that do are fixture',
    )
    await expect(list.run({ server: 'nobody' }, context)).rejects.toThrow(
      'nobody offers no resources',
    )
    await expect(
      read.run({ server: 'fixture', uri: 'notes://nothing' }, context),
    ).rejects.toThrow()
  })

  it('are not offered without a connected server that has them', async () => {
    const none = new McpServers({})
    expect(new ListMcpResourcesTool(none).unavailable()).toBe(
      'No connected MCP server offers resources.',
    )
    expect(new ReadMcpResourceTool(none).unavailable()).toContain(
      'No connected',
    )
    expect(list.unavailable()).toBeNull()
    expect(read.unavailable()).toBeNull()
  })

  it('are treated as someone else’s text, and say why they may ask', () => {
    expect(list.untrustedOutput).toBe(true)
    expect(read.untrustedOutput).toBe(true)
    expect(read.info.approval).toContain('set to ask first')
  })

  it('ask first only about a server that is set to', async () => {
    const asking = new McpServers({ fixture: { ...fixture, ask: true } })
    await asking.start()
    try {
      const registry = new ToolRegistry([
        new ListMcpResourcesTool(asking),
        new ReadMcpResourceTool(asking),
      ])
      expect(
        registry.needsApproval(
          call('read_mcp_resource', {
            server: 'fixture',
            uri: 'notes://readme',
          }),
          [],
        ),
      ).toBe(true)
      // Listing every server asks while one of them is set to.
      expect(
        registry.needsApproval(
          call('list_mcp_resources', { server: null }),
          [],
        ),
      ).toBe(true)
      // One that is not set to ask does not.
      const plain = new ToolRegistry([new ReadMcpResourceTool(servers)])
      expect(
        plain.needsApproval(
          call('read_mcp_resource', {
            server: 'fixture',
            uri: 'notes://readme',
          }),
          [],
        ),
      ).toBe(false)
    } finally {
      await asking.close()
    }
  })
})
