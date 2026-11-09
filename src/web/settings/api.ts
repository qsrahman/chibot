import type {
  McpDefinitions,
  McpServerConfig,
  McpSwitch,
} from '../../shared/mcp.ts'
import type { ToolInfo } from '../../shared/tools.ts'
import type {
  Settings,
  SettingsPatch,
  SettingsResponse,
} from '../../shared/settings.ts'
import type {
  Health,
  McpServerStatus,
  Memory,
  ModelsResponse,
  ModelWindowResponse,
  SkillsResponse,
} from '../../shared/types.ts'
import { remove, request, send } from '../http.ts'

export const getHealth = () => request<Health>('/api/health')

export const getSettings = () => request<SettingsResponse>('/api/settings')

export const updateSettings = (patch: SettingsPatch) =>
  request<Settings>('/api/settings', send('PATCH', patch))

export const modelWindow = (model: string) =>
  request<ModelWindowResponse>(
    `/api/models/window?model=${encodeURIComponent(model)}`,
  )
export const listModels = () => request<ModelsResponse>('/api/models')

export const listTools = () => request<{ tools: ToolInfo[] }>('/api/tools')

export const listMcpServers = () =>
  request<{ servers: McpServerStatus[] }>('/api/mcp')

/** Reads the MCP servers from the config again; the server answers with the new status. */
export const reloadMcpServers = () =>
  request<{ servers: McpServerStatus[] }>('/api/mcp/reload', {
    method: 'POST',
  })

export const reconnectMcpServer = (name: string) =>
  request(`/api/mcp/${name}/reconnect`, { method: 'POST' })

/** Where to send the browser to sign in, or `null` if it's signed in. */
export const signInToMcpServer = (name: string) =>
  request<{ url: string | null }>(`/api/mcp/${name}/sign-in`, {
    method: 'POST',
  })

export const signOutOfMcpServer = (name: string) =>
  request(`/api/mcp/${name}/sign-out`, { method: 'POST' })

export const listMcpDefinitions = () =>
  request<McpDefinitions>('/api/mcp/definitions')

/** Adds or changes a server; a blank `env` / `headers` value keeps the saved one. */
export const saveMcpServer = (name: string, server: McpServerConfig) =>
  request(`/api/mcp/servers/${name}`, send('PUT', server))

/** Turns a server, its approval or one of its tools on or off, in the config file. */
export const setMcpSwitch = (name: string, change: McpSwitch) =>
  request(`/api/mcp/servers/${name}`, send('PATCH', change))

export const removeMcpServer = (name: string) =>
  remove(`/api/mcp/servers/${name}`)

export const listMemories = () => request<Memory[]>('/api/memories')

/** Changes a memory's text. */
export const updateMemory = (id: number, text: string) =>
  request<Memory>(`/api/memories/${id}`, send('PATCH', { text }))

/** Deletes one memory, or all without `id`. */
export const deleteMemories = (id?: number) =>
  remove(`/api/memories${id === undefined ? '' : `/${id}`}`)

/** The skills in chibot's skills folder, and the folders in it that aren't valid ones. */
export const listSkills = () => request<SkillsResponse>('/api/skills')
