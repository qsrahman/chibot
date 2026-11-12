import type { DatabaseSync } from 'node:sqlite'
import {
  settingsSchema,
  type Settings,
  type SettingsPatch,
} from '../shared/settings.ts'
import type { ServiceModel } from '../shared/service-models.ts'
import { transaction } from './database.ts'

/**
 * Settings before the user changes anything; the models come from the
 * environment (`''` for a service without one).
 */
export function settingsDefaults(
  model: string,
  services: Partial<Pick<Settings, ServiceModel>> = {},
): Settings {
  return {
    model,
    imageModel: services.imageModel ?? '',
    embeddingModel: services.embeddingModel ?? '',
    rerankModel: services.rerankModel ?? '',
    embeddingQueryPrefix: '',
    embeddingDocumentPrefix: '',
    transcribeModel: services.transcribeModel ?? '',
    reasoningEffort: null,
    aboutUser: '',
    responseStyle: '',
    summaryModel: '',
    autoCompact: true,
    // Small enough for local models; the user raises it for larger ones.
    contextWindow: 32_000,
    compactAt: 75,
    compactReserve: 16_000,
    keepRecent: 15_000,
    disabledTools: [],
  }
}

/** Where chibot's own tools' switches are kept: the config file. */
export interface ToolSwitches {
  /** The tools switched off there; `null` when it has no list or can't be read just now (mid-edit): none are off. */
  read: () => string[] | null
  write: (tools: string[]) => void
}

/**
 * User preferences in SQLite, over defaults that come from the environment;
 * except the switches of chibot's own tools and skills, which live in the
 * config file beside the MCP servers'.
 */
export class SettingsStore {
  readonly #db: DatabaseSync
  readonly #defaults: Settings
  readonly #tools: ToolSwitches | null

  /** @param db from `openDatabase()` */
  constructor(db: DatabaseSync, defaults: Settings, tools?: ToolSwitches) {
    this.#db = db
    this.#defaults = defaults
    this.#tools = tools ?? null
  }

  get defaults(): Settings {
    return this.#defaults
  }

  get(): Settings {
    const rows = this.#db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    const stored: Record<string, unknown> = {}
    for (const { key, value } of rows) {
      try {
        stored[key] = JSON.parse(value)
      } catch {
        // A corrupt row falls back to its default below.
      }
    }
    // A stored value that no longer validates (e.g. after a schema change)
    // falls back to its default instead of breaking every request.
    const settings = { ...this.#defaults }
    for (const key of Object.keys(settings) as (keyof Settings)[]) {
      if (!(key in stored)) continue
      const parsed = settingsSchema.shape[key].safeParse(stored[key])
      if (parsed.success) Object.assign(settings, { [key]: parsed.data })
    }
    if (this.#tools) settings.disabledTools = this.#tools.read() ?? []
    return settings
  }

  /** Saves a validated patch and returns the resulting settings. */
  update(patch: SettingsPatch): Settings {
    if (this.#tools && patch.disabledTools) {
      // The file first: if it can't be written, nothing has changed.
      this.#tools.write(patch.disabledTools)
      const { disabledTools: _, ...rest } = patch
      patch = rest
    }
    const upsert = this.#db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    transaction(this.#db, () => {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) upsert.run(key, JSON.stringify(value))
      }
    })
    return this.get()
  }
}
