import { afterEach, describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { ModelRequests } from '../../../src/server/chat/model-requests.ts'

const requests = (
  models: Record<string, unknown>[] | Error,
  baseURL = 'http://localhost:11434/v1',
) =>
  new ModelRequests({
    baseURL,
    apiKey: 'k',
    models: {
      async *list() {
        if (models instanceof Error) throw models
        yield* models
      },
    },
  } as unknown as OpenAI)

const show = (res: Response | Error) =>
  vi.stubGlobal('fetch', async () => {
    if (res instanceof Error) throw res
    return res
  })

afterEach(() => vi.unstubAllGlobals())

describe('contextWindow', () => {
  it('reads the model list’s window (OpenRouter, LM Studio)', async () => {
    expect(
      await requests([{ id: 'a', context_length: 8000 }]).contextWindow('a'),
    ).toBe(8000)
    expect(
      await requests([{ id: 'a', max_context_length: 4096 }]).contextWindow(
        'a',
      ),
    ).toBe(4096)
  })

  it('reads num_ctx from Ollama when the model sets one', async () => {
    show(
      Response.json({ parameters: 'stop "x"\nnum_ctx 16384\ntemperature 1' }),
    )
    expect(await requests([{ id: 'a' }]).contextWindow('a')).toBe(16384)
  })

  it('says nothing rather than guess', async () => {
    show(Response.json({ parameters: 'temperature 1', model_info: {} }))
    expect(await requests([{ id: 'a' }]).contextWindow('a')).toBeNull()
    show(new Response('no', { status: 404 }))
    expect(await requests(new Error('down')).contextWindow('a')).toBeNull()
    show(new Error('offline'))
    expect(await requests([]).contextWindow('a')).toBeNull()
  })
})
