import type {
  FunctionTool,
  ResponseFunctionToolCall,
} from 'openai/resources/responses/responses'
import { z } from 'zod'
import type { Tool } from './tool.ts'

export const TOOL_STOPPED = 'The user stopped this tool call.'
export const TOOL_DENIED = 'The user denied this tool call.'

/** The tools offered to the model, and running the calls it makes. */
export class ToolRegistry {
  readonly #tools = new Map<string, Tool>()

  constructor(tools: Tool[]) {
    for (const tool of tools) {
      if (this.#tools.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`)
      }
      this.#tools.set(tool.name, tool)
    }
  }

  get declarations(): FunctionTool[] {
    return [...this.#tools.values()].map((tool) => tool.declaration)
  }

  get(name: string): Tool | undefined {
    return this.#tools.get(name)
  }

  /**
   * Runs `call` and returns its output. Never throws: unknown tools,
   * invalid arguments and tool errors become an `Error: …` output, so the
   * model can recover, and a stop becomes `TOOL_STOPPED`.
   */
  async run(
    call: ResponseFunctionToolCall,
    signal?: AbortSignal,
  ): Promise<string> {
    if (signal?.aborted) return TOOL_STOPPED
    const tool = this.#tools.get(call.name)
    if (!tool) return `Error: there is no tool named "${call.name}".`
    let json: unknown
    try {
      json = JSON.parse(call.arguments)
    } catch {
      return 'Error: the arguments are not valid JSON.'
    }
    const args = tool.parameters.safeParse(json)
    if (!args.success) {
      return `Error: invalid arguments: ${z.prettifyError(args.error)}`
    }
    try {
      return await tool.run(args.data, { signal })
    } catch (err) {
      if (signal?.aborted) return TOOL_STOPPED
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}
