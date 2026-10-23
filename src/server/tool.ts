import { zodResponsesFunction } from 'openai/helpers/zod'
import type { FunctionTool } from 'openai/resources/responses/responses'
import type { z } from 'zod'

/** What a tool run knows about where it was called. */
export interface ToolContext {
  /** The chat the call belongs to (e.g. to keep files with it). */
  conversationId: string
  /** Aborted when the user stops the answer. */
  signal?: AbortSignal
}

/**
 * A function the model can call. Subclasses set the fields and implement
 * `run`; `ToolRegistry` validates the arguments against `parameters` first.
 */
export abstract class Tool<Parameters extends z.ZodObject = z.ZodObject> {
  abstract readonly name: string
  /** Tells the model what the tool does and when to use it. */
  abstract readonly description: string
  abstract readonly parameters: Parameters
  /** Tools with side effects wait for the user's Approve / Deny. */
  readonly requiresApproval: boolean = false

  /** Returns the output the model sees. Throwing reports an error to it. */
  abstract run(
    args: z.output<Parameters>,
    context: ToolContext,
  ): Promise<string>

  /** The request's `tools` entry (strict JSON Schema from `parameters`). */
  get declaration(): FunctionTool {
    // The helper also attaches parsing hooks; send only the wire fields.
    const { type, name, description, parameters, strict } =
      zodResponsesFunction({
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      })
    return { type, name, description, parameters, strict }
  }
}
