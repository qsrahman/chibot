import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app.ts'
import { Config } from '../../src/server/config.ts'

describe('GET /api/health', () => {
  it('reports status and the configured model', async () => {
    const config = new Config({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm-1' })
    const res = await createApp({ config }).request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', model: 'm-1' })
  })
})
