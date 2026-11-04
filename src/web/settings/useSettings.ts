import { useCallback, useEffect, useState } from 'react'
import {
  SERVICE_MODELS,
  type ServiceModel,
} from '../../shared/service-models.ts'
import type { Settings, SettingsPatch } from '../../shared/settings.ts'
import type { ToolInfo } from '../../shared/tools.ts'
import { getSettings, listTools, updateSettings } from './api.ts'

const RELOAD_TOOLS = [
  ...SERVICE_MODELS,
  'disabledMcpServers',
  'askMcpServers',
] as const

/** The user's settings (PLAN.md §6, layer 2) and how to change them. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [defaults, setDefaults] = useState<Settings | null>(null)
  // Which of the other services have a server and key in .env.
  const [endpoints, setEndpoints] = useState<Record<ServiceModel, boolean>>({
    imageModel: false,
    embeddingModel: false,
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
        // These change what the tools say about themselves: a model decides
        // whether image creation can be used, a server's switches whether its
        // tools exist and whether they ask first.
        if (RELOAD_TOOLS.some((key) => key in patch)) void reloadTools()
        return true
      } catch (err) {
        setError((err as Error).message)
        return false
      }
    },
    [reloadTools],
  )

  return { settings, defaults, endpoints, tools, error, update }
}

export type SettingsApi = ReturnType<typeof useSettings>
