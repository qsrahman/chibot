// An MCP server for tests, over stdio. Tools: echo, slow (waits until it's
// cancelled), picture (a 1×1 PNG), fail (an isError result), crash (exits)
// and grow (adds an `extra` tool, so the server announces a changed list).
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { writeFileSync } from 'node:fs'
import { z } from 'zod'

export const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

/** The fixture's tools, on a server of its own (for any transport). */
export function fixtureServer(): McpServer {
  const server = new McpServer({ name: 'fixture', version: '1.0.0' })
  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Repeats the text',
      inputSchema: z.object({ text: z.string() }),
    },
    async ({ text }) => ({
      content: [{ type: 'text', text: `echo: ${text}` }],
    }),
  )
  server.registerTool(
    'slow',
    { description: 'Takes its time', inputSchema: z.object({}) },
    async (_args, ctx) => {
      // A test sets this to know the call reached the server before cancelling.
      const marker = process.env.CHIBOT_SLOW_MARKER
      if (marker) writeFileSync(marker, '')
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 30_000)
        ctx.mcpReq.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve(undefined)
        })
      })
      return { content: [{ type: 'text', text: 'done' }] }
    },
  )
  server.registerTool(
    'picture',
    { description: 'Returns a picture', inputSchema: z.object({}) },
    async () => ({
      content: [
        { type: 'text', text: 'Here it is.' },
        { type: 'image', data: PNG, mimeType: 'image/png' },
      ],
    }),
  )
  server.registerTool(
    'fail',
    { description: 'Always fails', inputSchema: z.object({}) },
    async () => ({
      isError: true,
      content: [{ type: 'text', text: 'it broke' }],
    }),
  )
  server.registerTool(
    'crash',
    { description: 'Stops the server', inputSchema: z.object({}) },
    async () => process.exit(1),
  )
  server.registerTool(
    'grow',
    { description: 'Adds a tool', inputSchema: z.object({}) },
    async () => {
      server.registerTool(
        'extra',
        { description: 'Added later', inputSchema: z.object({}) },
        async () => ({ content: [{ type: 'text', text: 'extra' }] }),
      )
      return { content: [{ type: 'text', text: 'grown' }] }
    },
  )
  return server
}

if (import.meta.main) {
  await fixtureServer().connect(new StdioServerTransport())
}
