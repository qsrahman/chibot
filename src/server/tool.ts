import { zodResponsesFunction } from 'openai/helpers/zod'
import type { FunctionTool } from 'openai/resources/responses/responses'
import type { z } from 'zod'
import type { ToolChip, ToolGroup, ToolInfo } from '../shared/tools.ts'
import type { Conversation } from '../shared/types.ts'

/** What a tool run knows about where it was called. */
export interface ToolContext {
  /** The chat the call belongs to (e.g. to keep files with it). */
  conversationId: string
  /** The chat's project, if it's in one. */
  projectId?: string | null
  /** Aborted when the user stops the answer. */
  signal?: AbortSignal
}

/** `signal` (the stop button), also aborting after `ms`, for slow requests. */
export const abortAfter = (ms: number, signal?: AbortSignal) =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms)

/**
 * A function the model can call. Subclasses set the fields and implement
 * `run`; `ToolRegistry` validates the arguments against `parameters` first.
 */
export abstract class Tool<Parameters extends z.ZodObject = z.ZodObject> {
  abstract readonly name: string
  /** What the user sees, e.g. in Settings: "Search the web". */
  abstract readonly label: string
  /** Tells the model what the tool does and when to use it. */
  abstract readonly description: string
  abstract readonly parameters: Parameters
  /** Where Settings lists it. */
  readonly group: ToolGroup = 'Other'
  /** What it does and what leaves this machine, for Settings (the user's words). */
  readonly summary: string = ''
  /** What an answer says while it runs and once it's done; "Running <label>…" / "Used <label>" if unset. */
  readonly running: string | undefined = undefined
  readonly done: string | undefined = undefined
  /** Set to offer it in the composer's "+" menu, for the next message. */
  readonly chip: ToolChip | null = null
  /**
   * Tools with side effects wait for the user's Approve / Deny: always, or
   * (`'after-untrusted'`) once the chat holds output of an `untrustedOutput`
   * tool, which may carry instructions planted for the model. See
   * `ToolRegistry.needsApproval`.
   */
  readonly requiresApproval: boolean | 'after-untrusted' = false
  /** The output holds text from others (web pages, search results). */
  readonly untrustedOutput: boolean = false
  /**
   * Whether the tool is offered in `conversation`. E.g. tools that read or
   * keep the user's history (memory, chat search) aren't in temporary chats,
   * which stay separate.
   */
  offeredIn(_conversation: Conversation): boolean {
    return true
  }

  /**
   * Why the tool can't be used now (what to set up), or `null`. Such a tool is
   * listed in Settings with that hint and never offered to the model.
   */
  unavailable(): string | null {
    return null
  }

  /** What the interface needs to know about the tool (`GET /api/tools`). */
  get info(): ToolInfo {
    return {
      name: this.name,
      label: this.label,
      group: this.group,
      summary: this.summary,
      running: this.running ?? `Running ${this.label}…`,
      done: this.done ?? `Used ${this.label}`,
      chip: this.chip,
      unavailable: this.unavailable(),
    }
  }

  /** Added to the chat's instructions while the tool is offered. */
  instructions(_conversation: Conversation): string | null {
    return null
  }

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
