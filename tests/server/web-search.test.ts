import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSearchTool } from '../../src/server/tools/web-search.ts'

const context = { conversationId: 'c' }

describe('WebSearchTool', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('queries Brave and returns plain-text results', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        web: {
          results: [
            {
              title: 'Node.js &amp; <strong>26</strong>',
              url: 'https://nodejs.org/',
              description: 'The <strong>Node.js</strong> 26 release',
              age: 'May 5, 2026',
              extra_snippets: ['More <strong>text</strong>'],
              profile: { name: 'ignored' },
            },
            { title: 'Bare', url: 'https://example.com/' },
          ],
        },
      }),
    )
    const tool = new WebSearchTool('key', 'https://brave.test/v1')

    const output = await tool.run(
      { query: 'node 26', freshness: 'week' },
      context,
    )

    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe(
      'https://brave.test/v1/web/search?q=node+26&count=5&freshness=pw',
    )
    expect(init?.headers).toMatchObject({ 'X-Subscription-Token': 'key' })
    expect(JSON.parse(output)).toEqual({
      query: 'node 26',
      results: [
        {
          title: 'Node.js & 26',
          url: 'https://nodejs.org/',
          description: 'The Node.js 26 release',
          age: 'May 5, 2026',
          snippets: ['More text'],
        },
        { title: 'Bare', url: 'https://example.com/', description: '' },
      ],
    })
  })

  it('reports Brave errors to the model', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('quota exceeded', { status: 429 }),
    )
    await expect(
      new WebSearchTool('key').run({ query: 'q', freshness: null }, context),
    ).rejects.toThrow('Brave Search answered 429: quota exceeded')
  })

  it('stops when the answer is stopped', async () => {
    const stop = new AbortController()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () =>
            reject(new Error('stopped')),
          )
        }),
    )
    const search = new WebSearchTool('key').run(
      { query: 'q', freshness: null },
      { ...context, signal: stop.signal },
    )
    stop.abort()
    await expect(search).rejects.toThrow('stopped')
  })

  it('gives up on a request that hangs', async () => {
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () =>
            reject(new Error('timed out')),
          )
        }),
    )
    const search = new WebSearchTool('key').run(
      { query: 'q', freshness: null },
      context,
    )
    timeout.abort()
    await expect(search).rejects.toThrow('timed out')
  })
})
