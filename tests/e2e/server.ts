// Starts chibot for the e2e tests with the shipped tools plus `e2e_note`,
// a test-only tool that needs approval (no shipped tool does yet).
import { z } from 'zod'
import { defaultTools, start } from '../../src/server/main.ts'
import { Tool } from '../../src/server/tool.ts'

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

start({ tools: (deps) => [...defaultTools(deps), new NoteTool()] })
