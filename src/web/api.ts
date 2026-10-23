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

export interface Health {
  status: string
  model: string
  baseURL: string | null
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const getHealth = () => request<Health>('/api/health')

export const getSettings = () => request<SettingsResponse>('/api/settings')

export const updateSettings = (patch: SettingsPatch) =>
  request<Settings>('/api/settings', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  })

export const listModels = () => request<ModelsResponse>('/api/models')

export const listTools = () => request<{ tools: ToolInfo[] }>('/api/tools')

export const listProjects = () => request<Project[]>('/api/projects')

export const getProject = (id: string) =>
  request<ProjectWithContents>(`/api/projects/${id}`)

export const createProject = (name: string) =>
  request<Project>('/api/projects', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  })

export const updateProject = (
  id: string,
  patch: { name?: string; instructions?: string },
) =>
  request<Project>(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  })

export async function deleteProject(id: string) {
  const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await errorMessage(res))
}

/** Uploads `file` and adds it to the project, which then indexes it. */
export async function addProjectFile(projectId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  const stored = await request<StoredFile>('/api/files', {
    method: 'POST',
    body: form,
  })
  return request<ProjectFile[]>(`/api/projects/${projectId}/files`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ fileId: stored.id }),
  })
}

export async function removeProjectFile(projectId: string, fileId: string) {
  const res = await fetch(`/api/projects/${projectId}/files/${fileId}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 404) throw new Error(await errorMessage(res))
}

export const listMemories = () => request<Memory[]>('/api/memories')

/** Deletes one memory (gone already is fine), or all without `id`. */
export async function deleteMemories(id?: number) {
  const res = await fetch(`/api/memories${id === undefined ? '' : `/${id}`}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 404) throw new Error(await errorMessage(res))
}

export const listConversations = ({ archived = false } = {}) =>
  request<ConversationListItem[]>(
    `/api/conversations${archived ? '?archived=1' : ''}`,
  )

export const searchConversations = (q: string, signal?: AbortSignal) =>
  request<ConversationListItem[]>(
    `/api/conversations?${new URLSearchParams({ q })}`,
    { signal },
  )

export const createConversation = ({
  temporary = false,
  projectId,
}: { temporary?: boolean; projectId?: string } = {}) =>
  request<Conversation>('/api/conversations', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ temporary, projectId }),
  })

export const getConversation = (id: string) =>
  request<ConversationWithItems>(`/api/conversations/${id}`)

export const updateConversation = (id: string, patch: ConversationPatch) =>
  request<Conversation>(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  })

/** `keepalive` lets the request finish while the page is unloading. */
export async function deleteConversation(
  id: string,
  { keepalive = false } = {},
) {
  const res = await fetch(`/api/conversations/${id}`, {
    method: 'DELETE',
    keepalive,
  })
  if (!res.ok && res.status !== 404) throw new Error(await errorMessage(res))
}

/** Where to download a conversation as Markdown or JSON. */
export const exportUrl = (id: string, format: 'md' | 'json') =>
  `/api/conversations/${id}/export?format=${format}`

/** Adds a chat from an exported JSON file; the server validates it. */
export async function importConversation(file: File) {
  return request<Conversation>('/api/conversations/import', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: await file.text(),
  })
}

/** Shows another version of a message or answer (see `Versions`). */
export async function switchVersion(conversationId: string, itemId: number) {
  const res = await fetch(`/api/conversations/${conversationId}/leaf`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ itemId }),
  })
  if (!res.ok) throw new Error(await errorMessage(res))
}

/** Runs a turn and yields the streamed events until it ends. */
export async function* streamTurn(
  conversationId: string,
  request: TurnRequest,
  signal: AbortSignal,
): AsyncGenerator<TurnEvent> {
  const res = await fetch(`/api/conversations/${conversationId}/turns`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json() as Promise<T>
}

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? `HTTP ${res.status}`
}
