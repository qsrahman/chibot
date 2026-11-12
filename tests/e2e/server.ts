// Starts chibot for the e2e tests with the shipped tools plus `e2e_note`, a
// test-only tool that needs approval (no shipped tool does yet). MCP servers
// (in .e2e-data/config/config.json):
// `fixture`, the local fixture server, and `tracker`, the same tools behind
// a fake OAuth provider on port 4012.
import { join } from 'node:path'
import { z } from 'zod'
import { writeConfigFile } from '../../src/server/config-file.ts'
import { defaultTools, start } from '../../src/server/main.ts'
import { publicOnly } from '../../src/server/media-proxy.ts'
import { Tool } from '../../src/server/tool.ts'
import { startOAuthServer } from '../fixtures/mcp-oauth-server.ts'

class NoteTool extends Tool {
  readonly name = 'e2e_note'
  readonly label = 'Notes (test)'
  readonly description = 'Saves a note.'
  readonly parameters = z.object({ text: z.string() })
  override readonly requiresApproval = true

  async run({ text }: { text: string }) {
    return `Saved note: ${text}`
  }
}

const tracker = await startOAuthServer({ port: 4012 })
writeConfigFile(process.env.CHIBOT_CONFIG_DIR!, {
  mcpServers: {
    fixture: {
      type: 'local',
      command: process.execPath,
      args: [join(import.meta.dirname, '../fixtures/mcp-server.ts')],
    },
    tracker: { type: 'remote', url: tracker.url },
  },
})

start({
  // The shipped tools, and one test-only tool that needs approval.
  tools: (deps) => [...defaultTools(deps), new NoteTool()],
  // Linked images and media may also come from the fake server on 127.0.0.1.
  mediaGuard: (address) => address === '127.0.0.1' || publicOnly(address),
})
