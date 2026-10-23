import { useCallback } from 'react'
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from './api.ts'
import { useLoad } from './useLoad.ts'

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

  const rename = useCallback(
    (id: string, name: string) => act(() => updateProject(id, { name })),
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
    rename,
    remove,
  }
}

export type ProjectsApi = ReturnType<typeof useProjects>
