import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MediaProxy } from '../../src/server/media-proxy.ts'
import { memoryStore, testApp } from './fakes.ts'

// /api/media: images and media that an answer links to, fetched by the server.
// An address nobody could have added data to loads by itself; any other waits
// for a click (`confirm=1`).

describe('GET /api/media', () => {
  let upstream: http.Server
  let base: string
  let hits: string[]
  beforeEach(async () => {
    hits = []
    upstream = http.createServer((req, res) => {
      hits.push(req.url!)
      const type = req.url!.startsWith('/logo.svg')
        ? 'image/svg+xml'
        : req.url!.startsWith('/page.png')
          ? 'text/html'
          : req.url!.startsWith('/clip.mp4')
            ? 'video/mp4'
            : req.url!.startsWith('/missing')
              ? 'text/plain'
              : 'image/png'
      if (req.url!.startsWith('/missing')) {
        res.writeHead(404)
        return res.end()
      }
      if (req.url!.startsWith('/huge')) {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': String(30 * 1024 * 1024),
        })
        return res.end('x')
      }
      if (req.headers.range) {
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': 'bytes 0-3/12',
          'Content-Length': '4',
        })
        return res.end('0123')
      }
      res.writeHead(200, { 'Content-Type': type })
      res.end('0123456789AB')
    })
    await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done))
    base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  })
  afterEach(() => upstream.close())

  /** A chat holding these items; its id. */
  function chat(
    items: Parameters<ReturnType<typeof memoryStore>['appendItems']>[2],
  ) {
    const store = memoryStore()
    const conversation = store.createConversation()
    store.appendItems(conversation.id, null, items)
    return {
      id: conversation.id,
      app: testApp({
        store,
        media: new MediaProxy({ allowed: () => true }),
      }),
    }
  }
  const user = (content: string) => ({ role: 'user' as const, content })
  const ask = (
    app: ReturnType<typeof chat>['app'],
    id: string,
    url: string,
    extra = '',
    headers: Record<string, string> = {},
  ) =>
    app.request(`/api/media?c=${id}&u=${encodeURIComponent(url)}${extra}`, {
      headers,
    })

  it('loads an address the user wrote, as the image it is, safely', async () => {
    const { id, app } = chat([user(`look at ${base}/photo.png please`)])
    const res = await ask(app, id, `${base}/photo.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
    expect(await res.text()).toBe('0123456789AB')
  })

  it('loads an address a tool returned', async () => {
    const { id, app } = chat([
      user('find one'),
      { type: 'function_call', call_id: 'c', name: 'search', arguments: '{}' },
      {
        type: 'function_call_output',
        call_id: 'c',
        output: JSON.stringify({ results: [{ image: `${base}/found.png` }] }),
      },
    ])
    expect((await ask(app, id, `${base}/found.png`)).status).toBe(200)
  })

  it('does not load by itself what the model wrote, or the data it added to a known address', async () => {
    const { id, app } = chat([
      user(`my picture is ${base}/mine.png`),
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        id: 'm',
        content: [
          {
            type: 'output_text',
            text: `![x](${base}/planted.png) and ![y](${base}/mine.png?d=secret)`,
            annotations: [],
          },
        ],
      },
    ])
    for (const url of [`${base}/planted.png`, `${base}/mine.png?d=secret`]) {
      const res = await ask(app, id, url)
      expect(res.status, url).toBe(403)
      expect(((await res.json()) as { error: string }).error).toMatch(
        /waits for a click/,
      )
    }
    // Nothing was requested from the site.
    expect(hits).toEqual([])
    // A click is the user's decision.
    const clicked = await ask(app, id, `${base}/planted.png`, '&confirm=1')
    expect(clicked.status).toBe(200)
    expect(hits).toEqual(['/planted.png'])
  })

  it('passes on a range, for sound and video that seek', async () => {
    const { id, app } = chat([user(`${base}/clip.mp4`)])
    const res = await ask(app, id, `${base}/clip.mp4`, '', {
      Range: 'bytes=0-3',
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-3/12')
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(await res.text()).toBe('0123')
  })

  it('shows only images, sound and video of a known size, never SVG or HTML', async () => {
    const { id, app } = chat([
      user(
        `${base}/logo.svg ${base}/page.png ${base}/huge.png ${base}/missing.png`,
      ),
    ])
    const status = async (path: string) =>
      (await ask(app, id, `${base}${path}`)).status
    expect(await status('/logo.svg')).toBe(415) // scripts
    expect(await status('/page.png')).toBe(415) // a page called .png
    expect(await status('/huge.png')).toBe(413)
    expect(await status('/missing.png')).toBe(404)
  })

  it('refuses this machine’s network by default, even when clicked', async () => {
    const store = memoryStore()
    const conversation = store.createConversation()
    store.appendItems(conversation.id, null, [user(`${base}/x.png`)])
    const app = testApp({ store, media: new MediaProxy() })
    const res = await ask(app, conversation.id, `${base}/x.png`, '&confirm=1')
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toMatch(
      /private or local/,
    )
    expect(hits).toEqual([])
  })

  it('answers only chibot’s own pages, not another site’s', async () => {
    const { id, app } = chat([user(`${base}/x.png`)])
    for (const site of ['cross-site', 'same-site', 'none']) {
      expect(
        (await ask(app, id, `${base}/x.png`, '', { 'Sec-Fetch-Site': site }))
          .status,
      ).toBe(403)
    }
    expect(
      (
        await ask(app, id, `${base}/x.png`, '', {
          'Sec-Fetch-Site': 'same-origin',
        })
      ).status,
    ).toBe(200)
    // curl and the like send nothing, and no website can drive them.
    expect((await ask(app, id, `${base}/x.png`)).status).toBe(200)
  })

  it('asks for a chat and an http(s) address, and a chat that exists', async () => {
    const { id, app } = chat([user('hi')])
    expect((await app.request('/api/media')).status).toBe(400)
    expect((await ask(app, id, 'javascript:alert(1)')).status).toBe(400)
    expect(
      (await ask(app, id, 'data:image/png;base64,AAAA', '&confirm=1')).status,
    ).toBe(400)
    expect((await ask(app, 'no-such-chat', `${base}/x.png`)).status).toBe(404)
  })
})
