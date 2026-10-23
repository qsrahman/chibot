import { useCallback, useEffect, useState } from 'react'
import type { Project } from '../shared/types.ts'
import { listProjects } from './api.ts'

/** The projects, for the sidebar and for "Move to project". */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { projects, error, refresh }
}

export type ProjectsApi = ReturnType<typeof useProjects>
