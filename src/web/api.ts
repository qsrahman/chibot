import { EventSourceParserStream } from 'eventsource-parser/stream'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses'
import type {
  Settings,
  SettingsPatch,
  SettingsResponse,
} from '../shared/settings.ts'
import type {
  Conversation,
  ConversationListItem,
  ConversationPatch,
  ConversationWithItems,
  Health,
  McpServerStatus,
  Memory,
  ModelsResponse,
  Project,
  ProjectFile,
  ProjectWithContents,
  StoredFile,
  ToolInfo,
  TurnApprovalEvent,
  TurnErrorEvent,
  TurnRequest,
  TurnTitleEvent,
  TurnToolOutputEvent,
} from '../shared/types.ts'

export type TurnEvent =
  | ResponseStreamEvent
  | TurnApprovalEvent
  | TurnErrorEvent
  | TurnTitleEvent
  | TurnToolOutputEvent

export const getHealth = () => request<Health>('/api/health')

export const getSettings = () => request<SettingsResponse>('/api/settings')

export const updateSettings = (patch: SettingsPatch) =>
  request<Settings>('/api/settings', send('PATCH', patch))

export const listModels = () => request<ModelsResponse>('/api/models')

export const listTools = () => request<{ tools: ToolInfo[] }>('/api/tools')

export const listMcpServers = () =>
  request<{ servers: McpServerStatus[] }>('/api/mcp')

export const reconnectMcpServer = (name: string) =>
  request(`/api/mcp/${name}/reconnect`, { method: 'POST' })

/** Where to send the browser to sign in, or `null` if it's signed in. */
export const signInToMcpServer = (name: string) =>
  request<{ url: string | null }>(`/api/mcp/${name}/sign-in`, {
    method: 'POST',
  })

export const signOutOfMcpServer = (name: string) =>
  request(`/api/mcp/${name}/sign-out`, { method: 'POST' })

export const listProjects = () => request<Project[]>('/api/projects')

export const getProject = (id: string) =>
  request<ProjectWithContents>(`/api/projects/${id}`)

export const createProject = (name: string) =>
  request<Project>('/api/projects', send('POST', { name }))

export const updateProject = (
  id: string,
  patch: { name?: string; instructions?: string },
) => request<Project>(`/api/projects/${id}`, send('PATCH', patch))

export const deleteProject = (id: string) => remove(`/api/projects/${id}`)

/** Stores a file (a document or an image) for a project or a message. */
export function uploadFile(file: File, signal?: AbortSignal) {
  const form = new FormData()
  form.append('file', file)
  return request<StoredFile>('/api/files', {
    method: 'POST',
    body: form,
    signal,
  })
}

/** Turns a recording into text (`health.features.transcription`). */
export async function transcribe(audio: Blob, signal?: AbortSignal) {
  const form = new FormData()
  // e.g. audio/webm;codecs=opus → recording.webm
  form.append(
    'file',
    audio,
    `recording.${/\/(\w+)/.exec(audio.type)?.[1] ?? 'webm'}`,
  )
  return (
    await request<{ text: string }>('/api/transcriptions', {
      method: 'POST',
      body: form,
      signal,
    })
  ).text
}

export async function addProjectFile(projectId: string, file: File) {
  const stored = await uploadFile(file)
  return request<ProjectFile[]>(
    `/api/projects/${projectId}/files`,
    send('POST', { fileId: stored.id }),
  )
}

export const removeProjectFile = (projectId: string, fileId: string) =>
  remove(`/api/projects/${projectId}/files/${fileId}`)

export const listMemories = () => request<Memory[]>('/api/memories')

/** Changes a memory's text. */
export const updateMemory = (id: number, text: string) =>
  request<Memory>(`/api/memories/${id}`, send('PATCH', { text }))

/** Deletes one memory, or all without `id`. */
export const deleteMemories = (id?: number) =>
  remove(`/api/memories${id === undefined ? '' : `/${id}`}`)

export const listConversations = ({ archived = false } = {}) =>
  request<ConversationListItem[]>(
    `/api/conversations${archived ? '?archived=1' : ''}`,
  )

export const searchConversations = (q: string, signal?: AbortSignal) =>
  request<ConversationListItem[]>(
    `/api/conversations?${new URLSearchParams({ q })}`,
    { signal },
  )

export const createConversation = (options: {
  temporary?: boolean
  projectId?: string
}) => request<Conversation>('/api/conversations', send('POST', options))

export const getConversation = (id: string) =>
  request<ConversationWithItems>(`/api/conversations/${id}`)

export const updateConversation = (id: string, patch: ConversationPatch) =>
  request<Conversation>(`/api/conversations/${id}`, send('PATCH', patch))

/** `keepalive` lets the request finish while the page is unloading. */
export const deleteConversation = (id: string, { keepalive = false } = {}) =>
  remove(`/api/conversations/${id}`, { keepalive })

/** Where to download a conversation as Markdown or JSON. */
export const exportUrl = (id: string, format: 'md' | 'json') =>
  `/api/conversations/${id}/export?format=${format}`

/** Adds a chat from an exported JSON file; the server validates it. */
export const importConversation = async (file: File) =>
  request<Conversation>('/api/conversations/import', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: await file.text(),
  })

/** Shows another version of a message or answer (see `Versions`). */
export const switchVersion = (conversationId: string, itemId: number) =>
  request<void>(
    `/api/conversations/${conversationId}/leaf`,
    send('PUT', { itemId }),
  )

/** Runs a turn and yields the streamed events until it ends. */
export async function* streamTurn(
  conversationId: string,
  request: TurnRequest,
  signal: AbortSignal,
): AsyncGenerator<TurnEvent> {
  const res = await fetch(`/api/conversations/${conversationId}/turns`, {
    ...send('POST', request),
    signal,
  })
  if (!res.ok) throw new Error(await errorMessage(res))
  // A reader loop rather than `for await`: Safari can't async-iterate streams.
  const reader = res
    .body!.pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    yield JSON.parse(value.data) as TurnEvent
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** A request with `body` as JSON. */
const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: JSON_HEADERS,
  body: JSON.stringify(body),
})

/** The JSON response, or nothing for an empty one (204). */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(await errorMessage(res))
  return (res.status === 204 ? undefined : await res.json()) as T
}

/** Deletes `url`. Already gone (404) is fine: the result is the same. */
async function remove(url: string, init?: RequestInit): Promise<void> {
  const res = await fetch(url, { ...init, method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(await errorMessage(res))
}

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? `HTTP ${res.status}`
}
