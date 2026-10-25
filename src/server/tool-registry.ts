import type { ResponseFunctionToolCall } from 'openai/resources/responses/responses'
import { z } from 'zod'
import type { Tool, ToolContext } from './tool.ts'

export const TOOL_STOPPED = 'The user stopped this tool call.'
export const TOOL_DENIED = 'The user denied this tool call.'

/** The tools offered to the model, and running the calls it makes. */
export class ToolRegistry {
  readonly #tools = new Map<string, Tool>()
  readonly #more: () => Tool[]

  /**
   * @param more tools that come and go (MCP servers'), asked for each time;
   *   their names never clash with chibot's own (they hold `__`)
   */
  constructor(tools: Tool[], more: () => Tool[] = () => []) {
    this.#more = more
    for (const tool of tools) {
      if (this.#tools.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`)
      }
      this.#tools.set(tool.name, tool)
    }
  }

  get tools(): Tool[] {
    return [...this.#tools.values(), ...this.#more()]
  }

  get(name: string): Tool | undefined {
    return this.#tools.get(name) ?? this.#more().find((t) => t.name === name)
  }

  /**
   * Runs `call` and returns its output. Never throws: unknown (or
   * `disabled`) tools, invalid arguments and tool errors become an
   * `Error: …` output, so the model can recover, and a stop becomes
   * `TOOL_STOPPED`.
   */
  async run(
    call: ResponseFunctionToolCall,
    context: ToolContext,
    disabled: string[] = [],
  ): Promise<string> {
    const { signal } = context
    if (signal?.aborted) return TOOL_STOPPED
    const tool = this.get(call.name)
    if (!tool || disabled.includes(tool.name))
      return `Error: there is no tool named "${call.name}".`
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
      return await tool.run(args.data, context)
    } catch (err) {
      if (signal?.aborted) return TOOL_STOPPED
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}
