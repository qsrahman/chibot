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

// Ollama's endpoints apart: what is running, and what a model's own settings say.
const ollama = (ps: Response | Error, showResponse: Response | Error) =>
  vi.stubGlobal('fetch', async (url: URL) => {
    const res = url.pathname === '/api/ps' ? ps : showResponse
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
    ollama(
      Response.json({ models: [] }),
      Response.json({ parameters: 'stop "x"\nnum_ctx 16384\ntemperature 1' }),
    )
    expect(await requests([{ id: 'a' }]).contextWindow('a')).toBe(16384)
  })

  it('reads the window a loaded Ollama model runs with', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: URL) => {
      calls.push(url.pathname)
      return Response.json({
        models: [
          { name: 'other:latest', context_length: 4096 },
          { name: 'a:latest', model: 'a:latest', context_length: 65536 },
        ],
      })
    })
    // The server's default, with no num_ctx in the model: only /api/ps knows.
    expect(await requests([{ id: 'a' }]).contextWindow('a')).toBe(65536)
    expect(calls).toEqual(['/api/ps'])
    expect(await requests([{ id: 'a:latest' }]).contextWindow('a:latest')).toBe(
      65536,
    )
  })

  it('falls back to the model’s own num_ctx when it is not loaded', async () => {
    ollama(
      Response.json({ models: [] }),
      Response.json({ parameters: 'num_ctx 8192' }),
    )
    expect(await requests([{ id: 'a' }]).contextWindow('a')).toBe(8192)
    ollama(
      new Response('no', { status: 404 }),
      Response.json({ parameters: 'num_ctx 2048' }),
    )
    expect(await requests([{ id: 'a' }]).contextWindow('a')).toBe(2048)
    // A server without /api/ps at all.
    ollama(new Error('refused'), Response.json({ parameters: 'x' }))
    expect(await requests([{ id: 'a' }]).contextWindow('a')).toBeNull()
  })

  it('says nothing rather than guess', async () => {
    ollama(
      Response.json({ models: [] }),
      Response.json({ parameters: 'temperature 1', model_info: {} }),
    )
    expect(await requests([{ id: 'a' }]).contextWindow('a')).toBeNull()
    show(new Response('no', { status: 404 }))
    expect(await requests(new Error('down')).contextWindow('a')).toBeNull()
    show(new Error('offline'))
    expect(await requests([]).contextWindow('a')).toBeNull()
  })
})
