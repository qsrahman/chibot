// User preferences (PLAN.md §6, layer 2). The web imports these as types only,
// so zod stays out of the browser bundle.
import { z } from 'zod'
import { REASONING_EFFORTS } from './reasoning.ts'
import type { ServiceModel } from './service-models.ts'

export const settingsSchema = z.object({
  /** Chat model for new turns. Defaults to `OPENAI_MODEL`. */
  model: z.string().trim().min(1).max(200),
  /**
   * The models of the other services, over the endpoints in chibot's config: `''`
   * turns the service off (image creation, search by meaning, voice input).
   */
  imageModel: z.string().trim().max(200),
  embeddingModel: z.string().trim().max(200),
  transcribeModel: z.string().trim().max(200),
  /** `null` sends no effort, so the model uses its own default. */
  reasoningEffort: z.enum(REASONING_EFFORTS).nullable(),
  /** Custom instructions: what chibot should know about the user. */
  aboutUser: z.string().max(1500),
  /** Custom instructions: how chibot should respond. */
  responseStyle: z.string().max(1500),
  /** Model that writes summaries of long chats; `''` uses the chat model. */
  summaryModel: z.string().trim().max(200),
  /** Summarize earlier messages when the context nears the window. */
  autoCompact: z.boolean(),
  /** Tokens the model reads at most (chibot can't ask the server). */
  contextWindow: z.number().int().min(2000).max(10_000_000),
  /** Percent of the window at which chibot compacts. */
  compactAt: z.number().int().min(10).max(95),
  /** Tokens kept free for the answer. */
  compactReserve: z.number().int().min(0).max(1_000_000),
  /** Tokens of the newest messages that stay word for word. */
  keepRecent: z.number().int().min(500).max(1_000_000),
  /** Tools switched off in Settings: never offered to the model. */
  disabledTools: z.array(z.string().max(100)).max(500),
  /** MCP servers switched off in Settings: not connected (`mcpServers`). */
  disabledMcpServers: z.array(z.string().max(100)).max(100),
  /** MCP servers whose tool calls wait for Approve / Deny. */
  askMcpServers: z.array(z.string().max(100)).max(100),
})

export type Settings = z.infer<typeof settingsSchema>

/** Body of `PATCH /api/settings`: any subset of the settings. */
export const settingsPatchSchema = settingsSchema.partial().strict()
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

/** `GET /api/settings`: current values and what they fall back to. */
export interface SettingsResponse {
  settings: Settings
  defaults: Settings
  /** Which of the other services have a server and key in the config; without one a model does nothing. */
  endpoints: Record<ServiceModel, boolean>
}
