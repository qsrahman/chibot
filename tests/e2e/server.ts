// Starts chibot for the e2e tests with the shipped tools plus `e2e_note`, a
// test-only tool that needs approval (no shipped tool does yet). Web search
// uses the fake server's Brave API, and fetch_url may also read the fake
// server's test page on 127.0.0.1.
import { z } from 'zod'
import { defaultTools, start } from '../../src/server/main.ts'
import { Tool } from '../../src/server/tool.ts'
import { FetchUrlTool, publicOnly } from '../../src/server/tools/fetch-url.ts'
import { WebSearchTool } from '../../src/server/tools/web-search.ts'

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

const fake = new URL(process.env.OPENAI_BASE_URL!).origin

start({
  tools: (deps) => [
    // Fake web search, and a page reader that may also read 127.0.0.1.
    ...defaultTools(deps).filter(
      (tool) => tool.name !== 'fetch_url' && tool.name !== 'web_search',
    ),
    new FetchUrlTool({
      allowed: (address) => address === '127.0.0.1' || publicOnly(address),
    }),
    new WebSearchTool('e2e', `${fake}/brave/res/v1`),
    new NoteTool(),
  ],
})
