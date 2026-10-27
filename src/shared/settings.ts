// User preferences (PLAN.md §6, layer 2). The web imports these as types only,
// so zod stays out of the browser bundle.
import { z } from 'zod'
import { REASONING_EFFORTS } from './reasoning.ts'

export const settingsSchema = z.object({
  /** Chat model for new turns. Defaults to `OPENAI_MODEL`. */
  model: z.string().trim().min(1).max(200),
  /** `null` sends no effort, so the model uses its own default. */
  reasoningEffort: z.enum(REASONING_EFFORTS).nullable(),
  /** Custom instructions: what chibot should know about the user. */
  aboutUser: z.string().max(1500),
  /** Custom instructions: how chibot should respond. */
  responseStyle: z.string().max(1500),
  /** Compact the context past this many tokens; `null` turns it off. */
  compactThreshold: z.number().int().min(1000).max(10_000_000).nullable(),
  /** Tools switched off in Settings: never offered to the model. */
  disabledTools: z.array(z.string().max(100)).max(500),
  /** MCP servers switched off in Settings: not connected (`mcp.json`). */
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
}
