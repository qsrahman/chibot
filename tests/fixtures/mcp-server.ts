// An MCP server for tests, over stdio. Resources: notes://readme (text),
// notes://logo (a PNG) and the template note://{id}. Tools: echo, slow (waits until it's
// cancelled), progress (1.5 s, reporting progress), picture (a 1×1 PNG), fail
// (an isError result), crash (exits)
// and grow (adds an `extra` tool, so the server announces a changed list).
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { writeFileSync } from 'node:fs'
import { z } from 'zod'

export const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

/** The fixture's tools, on a server of its own (for any transport). */
export function fixtureServer(): McpServer {
  const server = new McpServer(
    { name: 'fixture', version: '1.0.0' },
    { instructions: 'Use echo to repeat what the user says.' },
  )
  server.registerResource(
    'readme',
    'notes://readme',
    {
      title: 'Readme',
      description: 'What the notes are for',
      mimeType: 'text/plain',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: 'Notes live here.' }],
    }),
  )
  server.registerResource(
    'logo',
    'notes://logo',
    { description: 'A picture', mimeType: 'image/png' },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'image/png', blob: PNG }],
    }),
  )
  server.registerResource(
    'note',
    new ResourceTemplate('note://{id}', { list: undefined }),
    { title: 'A note', description: 'One note, by its id' },
    async (uri, { id }) => ({
      contents: [{ uri: uri.href, text: `Note ${id}.` }],
    }),
  )
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
    'progress',
    {
      description: 'Takes 1.5 s, reporting progress every 0.3 s',
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      const progressToken = ctx.mcpReq._meta?.progressToken
      for (let step = 1; step <= 5; step++) {
        await new Promise((resolve) => setTimeout(resolve, 300))
        if (progressToken !== undefined) {
          await ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: { progressToken, progress: step, total: 5 },
          })
        }
      }
      return { content: [{ type: 'text', text: 'finished' }] }
    },
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
