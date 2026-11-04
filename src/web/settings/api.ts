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
} from '../../shared/types.ts'
import { remove, request, send } from '../http.ts'

export const getHealth = () => request<Health>('/api/health')

export const getSettings = () => request<SettingsResponse>('/api/settings')

export const updateSettings = (patch: SettingsPatch) =>
  request<Settings>('/api/settings', send('PATCH', patch))

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

export const listMemories = () => request<Memory[]>('/api/memories')

/** Changes a memory's text. */
export const updateMemory = (id: number, text: string) =>
  request<Memory>(`/api/memories/${id}`, send('PATCH', { text }))

/** Deletes one memory, or all without `id`. */
export const deleteMemories = (id?: number) =>
  remove(`/api/memories${id === undefined ? '' : `/${id}`}`)
