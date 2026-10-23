import { useCallback, useEffect, useState } from 'react'
import type { Settings, SettingsPatch } from '../shared/settings.ts'
import type { ToolInfo } from '../shared/types.ts'
import { getSettings, listTools, updateSettings } from './api.ts'

/** The user's settings (PLAN.md §6, layer 2) and how to change them. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [defaults, setDefaults] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The server's tools; whether each is on comes from `disabledTools`.
  const [tools, setTools] = useState<Omit<ToolInfo, 'enabled'>[]>([])

  useEffect(() => {
    getSettings().then(
      (res) => {
        setSettings(res.settings)
        setDefaults(res.defaults)
      },
      (err: Error) => setError(err.message),
    )
    listTools().then(
      (res) => setTools(res.tools.map(({ name, label }) => ({ name, label }))),
      (err: Error) => setError(err.message),
    )
  }, [])

  /** Saves `patch`; resolves to whether it worked (errors land in `error`). */
  const update = useCallback(async (patch: SettingsPatch) => {
    try {
      setSettings(await updateSettings(patch))
      setError(null)
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    }
  }, [])

  return { settings, defaults, tools, error, update }
}

export type SettingsApi = ReturnType<typeof useSettings>
