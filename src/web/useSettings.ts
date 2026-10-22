import { useCallback, useEffect, useState } from 'react'
import type { Settings, SettingsPatch } from '../shared/settings.ts'
import { getSettings, updateSettings } from './api.ts'

/** The user's settings (PLAN.md §6, layer 2) and how to change them. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [defaults, setDefaults] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSettings().then(
      (res) => {
        setSettings(res.settings)
        setDefaults(res.defaults)
      },
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

  return { settings, defaults, error, update }
}

export type SettingsApi = ReturnType<typeof useSettings>
