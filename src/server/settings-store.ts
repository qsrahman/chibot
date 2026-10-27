import type { DatabaseSync } from 'node:sqlite'
import {
  settingsSchema,
  type Settings,
  type SettingsPatch,
} from '../shared/settings.ts'
import { transaction } from './database.ts'

/** Compact the context past this many tokens unless the user changes it. */
export const DEFAULT_COMPACT_THRESHOLD = 64_000

/** Settings before the user changes anything; `model` comes from the environment. */
export function settingsDefaults(model: string): Settings {
  return {
    model,
    reasoningEffort: null,
    aboutUser: '',
    responseStyle: '',
    compactThreshold: DEFAULT_COMPACT_THRESHOLD,
    disabledTools: [],
    disabledMcpServers: [],
    askMcpServers: [],
  }
}

/** User preferences in SQLite, over defaults that come from the environment. */
export class SettingsStore {
  readonly #db: DatabaseSync
  readonly #defaults: Settings

  /** @param db from `openDatabase()` */
  constructor(db: DatabaseSync, defaults: Settings) {
    this.#db = db
    this.#defaults = defaults
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
    return settings
  }

  /** Saves a validated patch and returns the resulting settings. */
  update(patch: SettingsPatch): Settings {
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
