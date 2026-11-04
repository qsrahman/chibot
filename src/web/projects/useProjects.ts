import { useCallback } from 'react'
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from './api.ts'
import { useLoad } from '../ui/useLoad.ts'

/** The projects (sidebar, "Move to project") and the actions that change them. */
export function useProjects() {
  const { data, error, reload, act } = useLoad(listProjects)

  /** Creates a project; resolves to it, or `null` if that failed. */
  const create = useCallback(
    async (name: string) => {
      let id: string | null = null
      await act(async () => (id = (await createProject(name)).id))
      return id
    },
    [act],
  )

  const update = useCallback(
    (id: string, patch: Parameters<typeof updateProject>[1]) =>
      act(() => updateProject(id, patch)),
    [act],
  )

  /** Deletes a project with its chats and files. */
  const remove = useCallback(
    (id: string) => act(() => deleteProject(id)),
    [act],
  )

  return {
    projects: data ?? [],
    error,
    refresh: reload,
    create,
    update,
    remove,
  }
}

export type ProjectsApi = ReturnType<typeof useProjects>
