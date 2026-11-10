import { Hono } from 'hono'
import type { SkillsResponse } from '../../shared/types.ts'
import type { SkillStore } from './skill-store.ts'

export function skillRoutes({ skills }: { skills: SkillStore }) {
  const app = new Hono()

  // What Settings lists: the skills, and the folders that are not valid ones.
  app.get('/api/skills', (c) => {
    const { skills: found, problems, skipped } = skills.list()
    return c.json({
      dir: skills.dir,
      skills: found.map(({ name, description }) => ({ name, description })),
      problems,
      skipped,
    } satisfies SkillsResponse)
  })

  return app
}
