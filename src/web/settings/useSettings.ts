import { useCallback, useEffect, useState } from 'react'
import {
  SERVICE_MODELS,
  type ServiceModel,
} from '../../shared/service-models.ts'
import type { Settings, SettingsPatch } from '../../shared/settings.ts'
import type { ToolInfo } from '../../shared/tools.ts'
import { getSettings, listTools, updateSettings } from './api.ts'

const RELOAD_TOOLS = SERVICE_MODELS

/** The user's settings (PLAN.md §6, layer 2) and how to change them. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [defaults, setDefaults] = useState<Settings | null>(null)
  // Which of the other services have a server and key in chibot's config.
  const [endpoints, setEndpoints] = useState<Record<ServiceModel, boolean>>({
    imageModel: false,
    embeddingModel: false,
    rerankModel: false,
    transcribeModel: false,
  })
  const [error, setError] = useState<string | null>(null)
  // The server's tools; whether each is on comes from `disabledTools`.
  const [tools, setTools] = useState<ToolInfo[]>([])

  const reloadTools = useCallback(
    () =>
      listTools().then(
        (res) => setTools(res.tools),
        (err: Error) => setError(err.message),
      ),
    [],
  )

  useEffect(() => {
    getSettings().then(
      (res) => {
        setSettings(res.settings)
        setDefaults(res.defaults)
        setEndpoints(res.endpoints)
      },
      (err: Error) => setError(err.message),
    )
    reloadTools()
  }, [reloadTools])

  /** Saves `patch`; resolves to whether it worked (errors land in `error`). */
  const update = useCallback(
    async (patch: SettingsPatch) => {
      try {
        setSettings(await updateSettings(patch))
        setError(null)
        // A model decides whether image creation can be used. (An MCP server's
        // switches are in the config file: `reloadTools` after those.)
        if (RELOAD_TOOLS.some((key) => key in patch)) void reloadTools()
        return true
      } catch (err) {
        setError((err as Error).message)
        return false
      }
    },
    [reloadTools],
  )

  return { settings, defaults, endpoints, tools, error, update, reloadTools }
}

export type SettingsApi = ReturnType<typeof useSettings>
