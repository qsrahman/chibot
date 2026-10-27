import { Hono } from 'hono'
import { MAX_MEMORY_LENGTH } from '../../shared/memory.ts'
import { memoryPatchSchema } from '../../shared/requests.ts'
import { normalizeMemory } from '../memory-store.ts'
import type { AppDeps } from '../app.ts'
import { json, notFound } from './helpers.ts'

export function memoryRoutes({ memories }: AppDeps) {
  const app = new Hono()

  app.get('/api/memories', (c) => c.json(memories.list().reverse()))

  app.patch('/api/memories/:id', json(memoryPatchSchema), (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || !memories.get(id)) {
      return notFound(c, 'Memory')
    }
    const text = normalizeMemory(c.req.valid('json').text)
    if (!text) return c.json({ error: 'A memory needs its text' }, 400)
    if (text.length > MAX_MEMORY_LENGTH) {
      return c.json(
        { error: `A memory can be at most ${MAX_MEMORY_LENGTH} characters` },
        400,
      )
    }
    const duplicate = memories.find(text)
    if (duplicate && duplicate.id !== id) {
      return c.json(
        { error: `That is already remembered: "${duplicate.text}"` },
        409,
      )
    }
    return c.json(memories.update(id, text)!)
  })

  app.delete('/api/memories/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || !memories.delete(id)) {
      return notFound(c, 'Memory')
    }
    return c.body(null, 204)
  })

  app.delete('/api/memories', (c) => {
    memories.clear()
    return c.body(null, 204)
  })

  return app
}
