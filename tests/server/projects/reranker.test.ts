import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../../src/server/database.ts'
import {
  ProjectIndex,
  ProjectStore,
  Reranker,
} from '../../../src/server/projects/index.ts'
import { testFiles } from '../fakes.ts'

const reply = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
const results = (...scored: [index: number, score: number][]) => ({
  results: scored.map(([index, relevance_score]) => ({
    index,
    relevance_score,
  })),
})

afterEach(() => vi.restoreAllMocks())

describe('Reranker', () => {
  const make = (model = 'rr-1') =>
    new Reranker({
      baseURL: 'http://rerank.test/v1/',
      apiKey: 'k',
      model: () => model,
    })

  it('asks the /rerank route and puts the best passage first', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => reply(results([0, 0.1], [1, 0.9], [2, 0.5])))
    expect(await make().rank('q', ['a', 'b', 'c'])).toEqual([1, 2, 0])
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('http://rerank.test/v1/rerank')
    expect(init!.headers).toMatchObject({ Authorization: 'Bearer k' })
    expect(JSON.parse(init!.body as string)).toEqual({
      model: 'rr-1',
      query: 'q',
      documents: ['a', 'b', 'c'],
      top_n: 3,
    })
  })

  it('keeps passages the server left out, and ignores bad positions', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      reply(results([2, 0.9], [2, 0.8], [7, 0.7])),
    )
    expect(await make().rank('q', ['a', 'b', 'c'])).toEqual([2, 0, 1])
  })

  it('returns null when the server fails or answers oddly', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetch = vi.spyOn(globalThis, 'fetch')
    fetch.mockImplementationOnce(() => reply({ error: 'no model' }, 404))
    expect(await make().rank('q', ['a'])).toBeNull()
    fetch.mockImplementationOnce(() => reply({ nothing: true }))
    expect(await make().rank('q', ['a'])).toBeNull()
    fetch.mockImplementationOnce(() => Promise.reject(new Error('refused')))
    expect(await make().rank('q', ['a'])).toBeNull()
  })

  it('lets a stop through', async () => {
    const stop = new AbortController()
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      stop.abort()
      return Promise.reject(new DOMException('aborted', 'AbortError'))
    })
    await expect(make().rank('q', ['a'], stop.signal)).rejects.toThrow()
  })

  it('is on while a model is set', () => {
    expect(make().on).toBe(true)
    expect(make('').on).toBe(false)
  })
})

describe('project search with a reranking model', () => {
  async function setup(model = 'rr-1') {
    const db = openDatabase(':memory:')
    const files = testFiles(db)
    const projects = new ProjectStore(db, files)
    let current = model
    const reranker = new Reranker({
      baseURL: 'http://rerank.test/v1',
      apiKey: 'k',
      model: () => current,
    })
    const index = new ProjectIndex(db, projects, files, null, reranker)
    const project = projects.create('P').id
    // Keyword search ranks "zebra" in the first file over the others.
    for (const [name, text] of [
      ['zebra.md', 'zebra zebra zebra stripes'],
      ['horse.md', 'a horse and a zebra'],
      ['cow.md', 'zebra among cows'],
    ]) {
      const file = files.save(null, name, 'text/markdown', Buffer.from(text))
      projects.addFile(project, file.id)
      await index.index(file.id)
    }
    return { index, project, off: () => (current = '') }
  }
  const names = (passages: { name: string }[]) => passages.map((p) => p.name)

  it('returns the passages in the order the reranking model gives', async () => {
    const { index, project } = await setup()
    const plain = names(await index.search(project, 'zebra'))
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_, init) => {
        const { documents } = JSON.parse(init!.body as string) as {
          documents: string[]
        }
        // The last passage wins.
        return reply(
          results(...documents.map((_, i): [number, number] => [i, i])),
        )
      })
    const reranked = names(await index.search(project, 'zebra'))
    expect(reranked).toEqual(plain.toReversed())
    expect(fetch).toHaveBeenCalledOnce()
    // Only as many as were asked for.
    expect(await index.search(project, 'zebra', { limit: 1 })).toHaveLength(1)
  })

  it('keeps the order search gave when the server fails, or the model is off', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { index, project, off } = await setup()
    const plain = names(await index.search(project, 'zebra'))
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.reject(new Error('down')))
    expect(names(await index.search(project, 'zebra'))).toEqual(plain)
    expect(fetch).toHaveBeenCalledOnce()
    off()
    expect(names(await index.search(project, 'zebra'))).toEqual(plain)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not ask when there is nothing to put in order', async () => {
    const { index, project } = await setup()
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect(await index.search(project, 'unicorn')).toEqual([])
    await index.search(project, 'stripes')
    expect(fetch).not.toHaveBeenCalled()
  })
})
