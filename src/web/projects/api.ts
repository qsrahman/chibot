import type {
  Project,
  ProjectFile,
  ProjectWithContents,
} from '../../shared/types.ts'
import { remove, request, send, uploadFile } from '../http.ts'

export const listProjects = () => request<Project[]>('/api/projects')

export const getProject = (id: string) =>
  request<ProjectWithContents>(`/api/projects/${id}`)

export const createProject = (name: string) =>
  request<Project>('/api/projects', send('POST', { name }))

export const updateProject = (
  id: string,
  patch: { name?: string; description?: string; instructions?: string },
) => request<Project>(`/api/projects/${id}`, send('PATCH', patch))

/** A draft of the project's instructions from its files; nothing is saved. */
export const suggestProjectInstructions = (id: string) =>
  request<{ instructions: string }>(
    `/api/projects/${id}/suggest-instructions`,
    { method: 'POST' },
  )

export const deleteProject = (id: string) => remove(`/api/projects/${id}`)

export async function addProjectFile(projectId: string, file: File) {
  const stored = await uploadFile(file)
  return request<ProjectFile[]>(
    `/api/projects/${projectId}/files`,
    send('POST', { fileId: stored.id }),
  )
}

export const reindexProjectFile = (projectId: string, fileId: string) =>
  request<void>(`/api/projects/${projectId}/files/${fileId}/index`, {
    method: 'POST',
  })

export const removeProjectFile = (projectId: string, fileId: string) =>
  remove(`/api/projects/${projectId}/files/${fileId}`)
